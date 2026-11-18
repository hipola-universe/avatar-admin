package org.sebi;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.is;

/** Needs Docker: Dev Services start Redis and Kafka for the test. */
@QuarkusTest
class ChatResourceTest {

    @Test
    void nobodyOnThePlanetAtStartup() {
        given()
          .when().get("/initChat/avatars")
          .then()
             .statusCode(200)
             .body("$", is(empty()));
    }

    @Test
    void noConversationAtStartup() {
        given()
          .when().get("/initChat/conversations")
          .then()
             .statusCode(200)
             .body("$", is(empty()));
    }

}
