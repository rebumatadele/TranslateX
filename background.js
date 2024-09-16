chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Received message in background:", message);

    if (message.type === 'TRANSLATE_TEXT') {
        // Handle asynchronous operation for multiple texts
        const prompt = message.prompt
        console.log("Message", message.texts)
        translateTextWithGemini(message.texts, prompt)
            .then(translatedTexts => {
                console.log("Sending translated texts back:", translatedTexts);
                // Send back the structured response
                sendResponse({ translatedTexts });
            })
            .catch(error => {
                console.error("Error translating texts:", error);
                sendResponse({ error: "Translation failed" });
            });

        // Return true to indicate that sendResponse will be called asynchronously
        return true;
    }
});

async function translateTextWithGemini(texts, prompt) {
    const apiKey = 'AIzaSyARFySyhjCOD4VLh0r6TB_EOy1CTTk7TaA';  // Replace with your actual API key
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const DELAY_MS = 0; // Delay between each request in milliseconds
    const results = [];
    const message = `${prompt} 
    Instructions: 1.  Remove any markup from the response 2.  Respond only with the translated term 3.  Separate each translation with an asterisk character 4.  If the message Raises a Safety issue, return translation of the safe version of the message`
    // Prepare the structured request with multiple texts in a single parts array
    const parts = texts.map(t => ({
        text: `${message} 
        The text i want you to translate: --> ${t}
        `
    }));

    console.log("Parts ", parts)
    const requestBody = {
        contents: [
            {
                parts: parts, // Combine all the texts into a single parts array
            }
        ]
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text(); // Read response text for debugging
            if (response.status === 429) { // Rate limit error
                console.error("Rate limit exceeded. Retrying after delay.");
                // Optionally implement retry logic if needed
            } else {
                throw new Error(`API request failed with status ${response.status}: ${errorText}`);
            }
        }

        const data = await response.json();
        console.log("Data Testing: ", data)

        if (data.candidates && data.candidates.length > 0) {
            let translatedText
            if(data.candidates[0]?.content === undefined){
                translatedText = texts
                alert(`Content Translation stopped due to: ${data.candidates[0]?.finishReason}`)
            }
            else{
                translatedText = data.candidates[0]?.content?.parts[0]?.text;
            }

            // Split the translated text by line (assuming each response is separated by a line)
            const translatedParts = translatedText.split('*').filter(part => part.trim() !== '');

            // Match the original texts with their translations
            texts.forEach((originalText, index) => {
                results.push({
                    originalText,
                    translatedText: translatedParts[index] || originalText
                });
            });
        } else {
            throw new Error('Unexpected response format');
        }

    } catch (error) {
        console.error("Error during translation:", error);
        throw new Error('Translation failed');
    }

    // Delay after each request, though now it's one batch
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));

    return results;
}
