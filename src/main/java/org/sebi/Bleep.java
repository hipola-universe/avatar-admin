package org.sebi;

/** A post on Bleep, as published on the Kafka topic "bleeps". imageURL is base64 data, a URL, or null. */
public record Bleep(String avatar, String message, String imageURL) {}
