package org.sebi;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.Collection;
import java.util.List;

import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.resteasy.reactive.RestStreamElementType;
import org.jboss.resteasy.reactive.server.multipart.FormValue;
import org.jboss.resteasy.reactive.server.multipart.MultipartFormDataInput;

import io.quarkus.logging.Log;
import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.pubsub.PubSubCommands;
import io.smallrye.common.annotation.Blocking;
import io.smallrye.mutiny.Multi;
import io.smallrye.mutiny.Uni;
import jakarta.annotation.PostConstruct;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/**
 * Mission control's HTTP API, used by the Phaser front-ends.
 *
 * <ul>
 *   <li>commands: start or stop a conversation, speak to the avatars (voice from the sky)</li>
 *   <li>live streams (SSE): arrivals, discussion lines, bleeps</li>
 *   <li>history (JSON): who is on the planet, past conversations, recent bleeps</li>
 * </ul>
 */
@Path("/initChat")
public class ChatResource {

    /** Directory where uploaded voice recordings are stored. */
    private static final String UPLOAD_DIR = "uploads/";

    @RestClient
    TranscriptionService transcriptionService;

    @Inject
    Planet planet;

    /** First line of every conversation; %s is the name of the avatar who says hi. */
    @ConfigProperty(name = "hipola.greeting", defaultValue = "Hi ! It's %s . How are you doing ? ")
    String greeting;

    @ConfigProperty(name = "hipola.transcription.model", defaultValue = "whisper-large-v3")
    String transcriptionModel;

    /** What the sky said, and who heard it. */
    public record Voice(String text, List<String> listeners) {}

    private final PubSubCommands<Notification> pub;

    /** Discussion lines slowed down to one every 5 seconds, shared by all the browsers of the stage view. */
    private Multi<DiscussionFragment> paced;

    public ChatResource(RedisDataSource ds) {
        pub = ds.pubsub(Notification.class);
    }

    @PostConstruct
    void init() {
        paced = planet.discussions()
                .onOverflow().buffer(2000)
                .onItem().call(fragment -> Uni.createFrom().nullItem().onItem().delayIt().by(Duration.ofSeconds(5)))
                .broadcast().toAllSubscribers();
    }

    // ------------------------------------------------------------------ live streams

    /** Arrivals ("Joining Hipola") and departures ("Leaving Hipola"), live. */
    @GET
    @Path("/joiners")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    @RestStreamElementType(MediaType.APPLICATION_JSON)
    public Multi<Notification> joiners() {
        return planet.joiners();
    }

    /** Discussion lines, one every 5 seconds so that speech bubbles can be read (stage view). */
    @GET
    @Path("/stream")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    @RestStreamElementType(MediaType.APPLICATION_JSON)
    public Multi<DiscussionFragment> stream() {
        return paced;
    }

    /** Discussion lines as soon as they are said (topdown view: each avatar has its own bubble). */
    @GET
    @Path("/live")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    @RestStreamElementType(MediaType.APPLICATION_JSON)
    public Multi<DiscussionFragment> live() {
        return planet.discussions();
    }

    @GET
    @Path("/bleeps")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    @RestStreamElementType(MediaType.APPLICATION_JSON)
    public Multi<Bleep> bleeps() {
        return planet.bleeps();
    }

    // ------------------------------------------------------------------ history

    /** Names of the avatars currently on Hipola, in order of arrival. */
    @GET
    @Path("/avatars")
    @Produces(MediaType.APPLICATION_JSON)
    public List<String> avatars() {
        return planet.avatars();
    }

    /** The last bleeps, oldest first (so that a reloaded page can refill its feed). */
    @GET
    @Path("/bleeps/history")
    @Produces(MediaType.APPLICATION_JSON)
    public List<Bleep> recentBleeps() {
        return planet.recentBleeps();
    }

    /** All conversations since the admin started, most recent first, without their messages. */
    @GET
    @Path("/conversations")
    @Produces(MediaType.APPLICATION_JSON)
    public List<Planet.Summary> conversations() {
        return planet.conversations();
    }

    /** One conversation with all its messages. */
    @GET
    @Path("/conversations/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Planet.Conversation conversation(@PathParam("id") int id) {
        Planet.Conversation conversation = planet.conversation(id);
        if (conversation == null) {
            throw new NotFoundException();
        }
        return conversation;
    }

    // ------------------------------------------------------------------ commands

    /** {initiator} says hi to {receiver}: the conversation starts. */
    @GET
    @Path("{initiator}/{receiver}")
    @Produces(MediaType.TEXT_PLAIN)
    public void hello(@PathParam("initiator") String initiator, @PathParam("receiver") String receiver) {
        pub.publish(receiver, new Notification(String.format(greeting, initiator), initiator));
    }

    /** Asks both avatars to wrap up: each one reflects and bleeps. */
    @GET
    @Path("stop/{initiator}/{receiver}")
    @Produces(MediaType.TEXT_PLAIN)
    public void stop(@PathParam("initiator") String initiator, @PathParam("receiver") String receiver) {
        pub.publish(receiver, new Notification(Planet.STOP, initiator));
        pub.publish(initiator, new Notification(Planet.STOP, receiver));
    }

    /**
     * The voice from the sky: an audio recording is transcribed (Whisper on Groq) and sent, as "sebi",
     * to every avatar on the planet. They take it as their new instructions.
     */
    @POST
    @Path("/audio")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    @Blocking
    public Voice uploadAudio(MultipartFormDataInput input) {
        Collection<FormValue> recordings = input.getValues().get("audio");
        if (recordings == null || recordings.isEmpty()) {
            throw voiceError(Response.Status.BAD_REQUEST, "No audio in the request.");
        }
        FormValue recording = recordings.iterator().next();
        String transcription;
        try {
            Files.createDirectories(Paths.get(UPLOAD_DIR));
            File file = new File(UPLOAD_DIR + Paths.get(recording.getFileName()).getFileName());
            try (InputStream in = recording.getFileItem().getInputStream()) {
                Files.copy(in, file.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
            transcription = transcriptionService.transcribeAudio(file, transcriptionModel).getText();
        } catch (IOException e) {
            Log.error("Could not store the audio recording", e);
            throw voiceError(Response.Status.INTERNAL_SERVER_ERROR, "Could not store the recording.");
        } catch (WebApplicationException e) {
            int status = e.getResponse().getStatus();
            Log.warn("Transcription refused by the speech-to-text service: HTTP " + status);
            throw voiceError(Response.Status.BAD_GATEWAY, status == 401
                    ? "The speech-to-text service refused the key (401). Set GROQ_API_KEY or OPENAI_API_KEY in demo/.env."
                    : "The speech-to-text service answered HTTP " + status + ".");
        }
        if (transcription == null || transcription.isBlank()) {
            throw voiceError(Response.Status.BAD_GATEWAY, "Nothing was understood in the recording.");
        }
        Log.info("Transcription : " + transcription);
        List<String> listeners = planet.avatars();
        if (listeners.isEmpty()) {
            listeners = List.of("bob", "alice");
        }
        for (String avatar : listeners) {
            pub.publish(avatar, new Notification(transcription, "sebi"));
        }
        return new Voice(transcription.trim(), listeners);
    }

    private static WebApplicationException voiceError(Response.Status status, String message) {
        return new WebApplicationException(Response.status(status).type(MediaType.APPLICATION_JSON).entity(java.util.Map.of("error", message)).build());
    }
}
