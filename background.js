const translationCache = new Map();  // A cache to store already translated texts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // console.log("Received message in background:", message);

    if (message.type === 'TRANSLATE_TEXT') {
        const prompt = message.prompt;
        // console.log("Message", message.texts);

        // Split texts into chunks with a max of 30,000 characters per chunk
        const maxChars = 3000;
        const chunks = [];
        let currentChunk = [];
        let currentChunkLength = 0;

        for (const text of message.texts) {
            const textLength = text.length;

            // If adding this text exceeds the max character limit, push the current chunk and start a new one
            if (currentChunkLength + textLength > maxChars) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentChunkLength = 0;
            }

            // Add the text to the current chunk and update the character count
            currentChunk.push(text);
            currentChunkLength += textLength;
        }

        // Push the final chunk if it contains any remaining texts
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        // Process chunks sequentially and combine results
        processChunksSequentially(chunks, prompt)
            .then(translatedTexts => {
                // console.log("Sending translated texts back:", translatedTexts);
                sendResponse({ translatedTexts });
            })
            .catch(error => {
                // console.error("Error translating texts:", error);
                sendResponse({ error: "Translation failed" });
            });

        // Return true to indicate that sendResponse will be called asynchronously
        return true;
    }
});

async function processChunksSequentially(chunks, prompt) {
    const allResults = [];

    for (const chunk of chunks) {
        const untranslatedChunk = chunk.filter(text => !translationCache.has(text));

        // If there are texts to translate
        if (untranslatedChunk.length > 0) {
            try {
                const result = await retryWithBackoff(() => translateTextWithGemini(untranslatedChunk, prompt));

                // Cache the translated results
                result.forEach(({ originalText, translatedText }) => {
                    translationCache.set(originalText, translatedText);
                });

            } catch (error) {
                // console.error("Translation failed for chunk:", error);

                // On failure, cache the original texts (i.e., untranslated texts remain in their positions)
                untranslatedChunk.forEach(text => {
                    translationCache.set(text, text);  // Fallback to original text
                });
            }
        }

        // Collect both cached and newly translated texts in their correct positions
        chunk.forEach(text => {
            const translatedText = translationCache.get(text);
            allResults.push({
                originalText: text,
                translatedText: translatedText || text  // Fallback to original if translation fails
            });
        });

        await new Promise(resolve => setTimeout(resolve, 1000));  // 1 second delay between chunks
    }

    return allResults;
}

async function retryWithBackoff(func, maxRetries = 5) {
    let delay = 1000; // Start with 1-second delay
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await func();
        } catch (error) {
            if (attempt === maxRetries || error.message !== 'Translation failed') {
                throw error;
            }
            // console.log(`Retry attempt ${attempt} failed. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            if (delay < 2) {
                delay *= 2; // Exponential backoff
            }
        }
    }
}
// translateTextWithGemini function remains unchanged
async function translateTextWithGemini(texts, prompt) {
    const apiKey = '';  // Replace with your actual API key
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const DELAY_MS = 0; // Delay between each request in milliseconds
    const results = [];
    const message = `${prompt} Instructions: 1. I will be providing a json format text for translation in {id: number, value: the text i want you to translate} structure  2. Do not alter the provided IDs 3. respond strictly in a list of JSON format with exactly [{id: number, value: translated_string}, {id: number, value: translated_string}] structure 4. don't use any newline in the response. 5. Remove any markup from the response. 6. Respond only with the translated list of key value pairs. 7. If the message Raises a Safety issue, return translation of the safe version of the message. 8. if you are provided by a special characters, don't attempt to translate it, just return the character 9. 
     `;

    const p = texts.map((text, index) => (`{ id: ${index}, value: ${text} }`));

    console.log("Parts with IDs:", p);

    const requestBody = {
        contents: [
            {
                parts: [
                    {text: "You are helpful translator "}, 
                    {text: "You will translate to "},
                    {text: message}, 
                    ...p.map(text => ({ text }))  // Spread the array into individual entries
                ], // Combine all the texts into a single parts array
            }
        ],
        generationConfig: { response_mime_type: "application/json" },

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
        let parsedData = [];

        if (data.candidates && data.candidates.length > 0) {
            const translatedText = data.candidates[0]?.content?.parts[0]?.text;

            if (translatedText === undefined) {
                // console.log(`Content Translation stopped due to: ${data.candidates[0]?.finishReason}`);
                results.push(...texts.map(text => ({ originalText: text, translatedText: text })));
            } else {
                try {
                    // Try parsing the translated text
                    // console.log("Content Before Parsing", translatedText);
                    
                    // Safely check the format of translatedText before parsing
                    if (translatedText.trim().startsWith('[') && translatedText.trim().endsWith(']')) {
                        try {
                            parsedData = JSON.parse(translatedText);
                        } catch (error) {
                            console.error(`Error parsing JSON: ${error.message}`);
                            throw new Error('Failed to parse translated text');
                        }
                    } else {
                        throw new Error("Invalid JSON format in the response.");
                    }
                    

                    // console.log("Parsed Response", parsedData);

                    // Match the original texts with their translations
                    texts.forEach((originalText, index) => {
                        const parsedItem = parsedData.find(item => item.id === index);
                        results.push({
                            originalText,
                            translatedText: parsedItem ? parsedItem.value : originalText
                        });
                    });
                } catch (error) {
                    console.error(`Error parsing JSON: ${error.message}`);
                    throw new Error('Failed to parse translated text');
                }
            }
        } else {
            throw new Error('Unexpected response format');
        }

    } catch (error) {
        console.error("Error during translation:", error.message);
        throw new Error('Translation failed');
    }

    // Delay after each request, though now it's one batch
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));

    return results;
}
