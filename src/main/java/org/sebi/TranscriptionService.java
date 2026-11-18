package org.sebi;

import java.io.File;

import org.eclipse.microprofile.rest.client.annotation.ClientHeaderParam;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;
import org.jboss.resteasy.reactive.RestForm;

import jakarta.ws.rs.POST;


/** Speech to text through an OpenAI-compatible endpoint: Groq by default, see application.properties. */
@RegisterRestClient(configKey = "transcription")
public interface TranscriptionService {
    
    @POST
    @ClientHeaderParam(name = "Authorization", value = "Bearer ${qroq.token}") 
    Transcript transcribeAudio(@RestForm File file, @RestForm String model);

}
