package org.sebi;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import org.eclipse.microprofile.reactive.messaging.Incoming;

import io.quarkus.logging.Log;
import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.pubsub.PubSubCommands;
import io.quarkus.runtime.StartupEvent;
import io.smallrye.mutiny.Multi;
import io.smallrye.mutiny.operators.multi.processors.BroadcastProcessor;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

/**
 * What mission control knows about Hipola: who is there, what was said, what was bleeped.
 *
 * <p>Everything arrives here (Redis "immigration" channel, Kafka "discussions" and "bleeps" topics), is kept
 * in memory, and is re-broadcast to the browsers. Listening starts with the application, not with the first
 * browser, so a page opened late can still ask for what it missed.
 */
@ApplicationScoped
public class Planet {

    private static final int MAX_BLEEPS = 8;           // each one may carry a picture of several MB
    private static final int MAX_CONVERSATIONS = 500;
    static final String STOP = "[STOP]";

    public record Message(String from, String to, String message, long at) {}

    public record Summary(int id, String a, String b, long startedAt, long lastAt, int count, boolean ended, String preview) {}

    public static class Conversation {
        public final int id;
        public final String a;
        public final String b;
        public final long startedAt;
        public volatile long lastAt;
        public volatile boolean ended;
        public final List<Message> messages = new CopyOnWriteArrayList<>();

        Conversation(int id, String a, String b, long now) {
            this.id = id; this.a = a; this.b = b; this.startedAt = now; this.lastAt = now;
        }

        Summary summary() {
            String last = messages.isEmpty() ? "" : messages.get(messages.size() - 1).message().replace(STOP, "").trim();
            return new Summary(id, a, b, startedAt, lastAt, messages.size(), ended, last.length() > 90 ? last.substring(0, 90) + "…" : last);
        }
    }

    private final RedisDataSource redis;
    private PubSubCommands.RedisSubscriber subscriber;

    private final Map<String, Long> avatars = new LinkedHashMap<>();
    private final Deque<Bleep> bleeps = new ArrayDeque<>();
    private final Map<Integer, Conversation> conversations = new LinkedHashMap<>();
    private final Map<String, Conversation> open = new LinkedHashMap<>();
    private final AtomicInteger ids = new AtomicInteger();

    private final BroadcastProcessor<Notification> joinersLive = BroadcastProcessor.create();
    private final BroadcastProcessor<DiscussionFragment> discussionsLive = BroadcastProcessor.create();
    private final BroadcastProcessor<Bleep> bleepsLive = BroadcastProcessor.create();

    public Planet(RedisDataSource redis) {
        this.redis = redis;
    }

    void listen(@Observes StartupEvent event) {
        subscriber = redis.pubsub(Notification.class).subscribe("immigration", this::onImmigration);
        Log.info("Listening to the immigration channel");
    }

    // ------------------------------------------------------------------ arrivals and departures

    synchronized void onImmigration(Notification notification) {
        if (notification == null || notification.sender == null) {
            return;
        }
        if (notification.chat != null && notification.chat.startsWith("Leaving")) {
            avatars.remove(notification.sender);
        } else {
            avatars.put(notification.sender, System.currentTimeMillis());
        }
        joinersLive.onNext(notification);
    }

    public synchronized List<String> avatars() {
        return new ArrayList<>(avatars.keySet());
    }

    public Multi<Notification> joiners() {
        return joinersLive.onOverflow().drop();
    }

    // ------------------------------------------------------------------ discussions

    @Incoming("discussions")
    public synchronized void onFragment(DiscussionFragment fragment) {
        if (fragment == null || fragment.from() == null || fragment.to() == null || fragment.message() == null) {
            return;
        }
        long now = System.currentTimeMillis();
        String key = fragment.from().compareTo(fragment.to()) < 0 ? fragment.from() + "|" + fragment.to() : fragment.to() + "|" + fragment.from();
        Conversation conversation = open.get(key);
        if (conversation == null) {
            conversation = new Conversation(ids.incrementAndGet(), fragment.to(), fragment.from(), now);
            open.put(key, conversation);
            conversations.put(conversation.id, conversation);
            if (conversations.size() > MAX_CONVERSATIONS) {
                conversations.remove(conversations.keySet().iterator().next());
            }
        }
        conversation.messages.add(new Message(fragment.from(), fragment.to(), fragment.message(), now));
        conversation.lastAt = now;
        if (fragment.message().contains(STOP)) {
            // Someone said goodbye: the next line between these two starts a new conversation.
            conversation.ended = true;
            open.remove(key);
        }
        discussionsLive.onNext(fragment);
    }

    /** Every line, as soon as it is said. */
    public Multi<DiscussionFragment> discussions() {
        return discussionsLive.onOverflow().drop();
    }

    public synchronized List<Summary> conversations() {
        List<Summary> list = new ArrayList<>();
        for (Conversation conversation : conversations.values()) {
            list.add(0, conversation.summary()); // most recent first
        }
        return list;
    }

    public synchronized Conversation conversation(int id) {
        return conversations.get(id);
    }

    // ------------------------------------------------------------------ bleeps

    @Incoming("bleeps")
    public synchronized void onBleep(Bleep bleep) {
        if (bleep == null) {
            return;
        }
        bleeps.addLast(bleep);
        while (bleeps.size() > MAX_BLEEPS) {
            bleeps.removeFirst();
        }
        bleepsLive.onNext(bleep);
    }

    public Multi<Bleep> bleeps() {
        return bleepsLive.onOverflow().drop();
    }

    /** The last bleeps, oldest first. */
    public synchronized List<Bleep> recentBleeps() {
        return new ArrayList<>(bleeps);
    }
}
