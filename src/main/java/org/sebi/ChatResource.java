package org.sebi;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.Collection;
import java.util.Map;
import java.util.function.Consumer;

import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;
import org.eclipse.microprofile.reactive.messaging.Incoming;
import org.eclipse.microprofile.reactive.messaging.Outgoing;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.resteasy.reactive.server.multipart.FormValue;
import org.jboss.resteasy.reactive.server.multipart.MultipartFormDataInput;

import io.quarkus.logging.Log;
import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.pubsub.PubSubCommands;
import io.smallrye.common.annotation.Blocking;
import io.smallrye.mutiny.Multi;
import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/**
 * REST resource for handling chat-related functionality including real-time messaging,
 * audio transcription, and user notifications.
 * 
 * <p>This resource provides endpoints for:
 * <ul>
 *   <li>Real-time messaging between users via Server-Sent Events (SSE)</li>
 *   <li>Audio file upload and transcription using external transcription services</li>
 *   <li>User notification system using Redis pub/sub</li>
 *   <li>Discussion streaming with configurable delays</li>
 * </ul>
 * 
 * <p>The class integrates with Redis for pub/sub messaging and uses reactive messaging
 * channels for internal communication between different components.
 * 
 * @author sebi
 * @version 1.0
 * @since 1.0
 */
@Path("/initChat")
public class ChatResource implements Consumer<Notification> {

    @RestClient
    TranscriptionService transcriptionService;

    private PubSubCommands<Notification> pub;

    private PubSubCommands.RedisSubscriber subscriber;

    @Channel("internal-notification")
    Emitter<Notification> emitter; 

    @Inject
    @Channel("joiners-out")
    Multi<Notification> joiners;

    /**
     * Constructs a new ChatResource with Redis pub/sub capabilities.
     * 
     * <p>Initializes the Redis pub/sub commands and subscribes to the "immigration" channel
     * to receive notifications that will be processed by this resource.
     * 
     * @param ds the Redis data source for pub/sub operations
     */
    public ChatResource(RedisDataSource ds) {
        pub = ds.pubsub(Notification.class);
        subscriber = pub.subscribe("immigration", this);
    }

    /**
     * Processes incoming notifications from Redis pub/sub and forwards them to the internal
     * notification channel.
     * 
     * <p>This method is called automatically when a notification is received from the 
     * subscribed Redis channel.
     * 
     * @param notification the notification received from Redis pub/sub
     */
    @Override
    public void accept(Notification notification) {
     emitter.send(notification);
    }

    /**
     * Handles internal notifications and forwards them to the joiners output channel.
     * 
     * <p>This method processes notifications from the internal notification channel
     * and makes them available to the joiners stream. The method is blocking to ensure
     * proper message processing.
     * 
     * @param notification the notification to be processed
     * @return the same notification for forwarding to joiners
     */
    @Incoming("internal-notification")
    @Outgoing("joiners-out")
    @Blocking
    public Notification handleNotif(Notification notification){
        return notification;
    }

    /**
     * Provides a Server-Sent Events (SSE) stream of user joiners/notifications.
     * 
     * <p>This endpoint allows clients to subscribe to real-time updates about users
     * joining the chat system. The stream remains open and pushes notifications
     * as they occur.
     * 
     * @return a Multi stream of Notification objects sent as SSE
     * @throws InterruptedException if the thread is interrupted while setting up the stream
     */
    @GET
    @Path("/joiners")
    @Produces(MediaType.SERVER_SENT_EVENTS) 
    public Multi<Notification> joiners() throws InterruptedException{
       return joiners;
    }

    /**
     * Represents a fragment of discussion between two users.
     * 
     * @param from the sender of the message
     * @param to the recipient of the message  
     * @param message the content of the message
     */
    private record DiscussionFragment(String from, String to, String message) {}

    /**
     * Represents a bleep message with avatar information.
     * 
     * @param avatar the avatar identifier
     * @param message the message content
     * @param imageURL the URL of the associated image
     */
    private record Bleep(String avatar, String message, String imageURL) {}

    @Channel("discussions")
    Multi<DiscussionFragment> discussions;

    @Channel("bleeps")
    Multi<Bleep> bleeps;

    /**
     * Provides a Server-Sent Events (SSE) stream of discussion fragments with a delay.
     * 
     * <p>This endpoint streams discussion fragments to clients with a 5-second delay
     * between each message emission. This can be useful for creating a more natural
     * conversation flow or for testing purposes.
     * 
     * @return a Multi stream of DiscussionFragment objects with 5-second delays
     * @throws InterruptedException if the thread is interrupted while setting up the stream
     */
    @GET
    @Path("/stream")
    @Produces(MediaType.SERVER_SENT_EVENTS) 
    public Multi<DiscussionFragment> stream() throws InterruptedException{
        return   discussions.onItem().call(i ->
        // Delay the emission until the returned uni emits its item
        Uni.createFrom().nullItem().onItem().delayIt().by(Duration.ofMillis(5000))
    );
    }

    /**
     * Provides a Server-Sent Events (SSE) stream of bleep messages.
     * 
     * <p>This endpoint allows clients to subscribe to real-time bleep messages,
     * which typically contain avatar information and associated images.
     * 
     * @return a Multi stream of Bleep objects sent as SSE
     */
    @GET
    @Path("/bleeps")
    @Produces(MediaType.SERVER_SENT_EVENTS) 
    public Multi<Bleep> bleeps() {
        return bleeps;
    }

    /**
     * Initiates a chat conversation between two users by sending a greeting message.
     * 
     * <p>This endpoint publishes a greeting notification to the receiver's channel,
     * allowing the initiator to start a conversation. The message is delivered
     * through the Redis pub/sub system.
     * 
     * @param initiator the username of the person starting the conversation
     * @param receiver the username of the person receiving the greeting
     */
    @GET
    @Path("{initiator}/{receiver}")
    @Produces(MediaType.TEXT_PLAIN)
    public void hello(@PathParam("initiator") String initiator, @PathParam("receiver") String receiver) {
        pub.publish(receiver, new Notification("Hi ! It's "+ initiator +" . How are you doing ? ", initiator));
    }

    /**
     * Stops an ongoing conversation between two users.
     * 
     * <p>This endpoint sends a stop signal to both participants in a conversation,
     * effectively ending the chat session. Both users receive a [STOP] notification
     * through their respective Redis channels.
     * 
     * @param initiator the username of one participant in the conversation
     * @param receiver the username of the other participant in the conversation
     */
    @GET
    @Path("stop/{initiator}/{receiver}")
    @Produces(MediaType.TEXT_PLAIN)
    public void stop(@PathParam("initiator") String initiator, @PathParam("receiver") String receiver) {
        pub.publish(receiver, new Notification("[STOP]", initiator));
        pub.publish(initiator, new Notification("[STOP]", receiver));
    }

    /** Directory path for storing uploaded audio files */
    private static final String UPLOAD_DIR = "uploads/";

    /**
     * Handles audio file uploads and performs transcription.
     * 
     * <p>This endpoint accepts multipart form data containing audio files, saves them
     * to the local filesystem, and then transcribes the audio content using an external
     * transcription service. The transcribed text is then published to predefined
     * user channels (bob and alice) for further processing.
     * 
     * <p>The transcription process uses the "whisper-large-v3" model for audio-to-text
     * conversion. The uploaded files are stored in the {@code uploads/} directory.
     * 
     * @param input the multipart form data containing the audio file(s) to be transcribed
     * @throws RuntimeException if file I/O operations fail during upload or transcription
     * 
     * @see TranscriptionService#transcribeAudio(File, String)
     */
    @POST
    @Path("/audio")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    public void uploadAudio(MultipartFormDataInput input){
       Map<String, Collection<FormValue>> map = input.getValues();
       Collection<FormValue> collection =  map.get("audio");
       collection.forEach(formValue -> {
          
         
           try {
            String fileName = formValue.getFileName();
            InputStream is = formValue.getFileItem().getInputStream();
               Files.createDirectories(Paths.get(UPLOAD_DIR));
               File file = new File(UPLOAD_DIR + fileName);
               try (InputStream inputStream = is;
                    FileOutputStream outputStream = new FileOutputStream(file)) {
                   byte[] buffer = new byte[1024];
                   int bytesRead;
                   while ((bytesRead = inputStream.read(buffer)) != -1) {
                       outputStream.write(buffer, 0, bytesRead);
                   }
               }
             String transcription =  transcriptionService.transcribeAudio(file, "whisper-large-v3").getText();
             Log.info("Transcription : "+transcription);
             pub.publish("bob", new Notification(transcription, "sebi"));
             pub.publish("alice", new Notification(transcription, "sebi"));
           } catch (IOException e) {
               e.printStackTrace();
           }
        }
       ); 
    }   
}
