package org.sebi;

/** One line said by an avatar, as published on the Kafka topic "discussions". */
public record DiscussionFragment(String from, String to, String message) {}
