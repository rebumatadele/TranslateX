chrome.storage.local.get(['isEnabled', "language"], (result) => {
    const isEnabled = result.isEnabled ?? true;
    const prompt = result.language
    console.log('Loaded state:', isEnabled);
    console.log('Loaded language:', prompt); // Debugging line

    if (isEnabled) {

        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        let translationQueue = [];
        let queuedElementsSet = new Set();
        let processedElementsSet = new Set(); // Track processed elements
        let isTranslating = false;
        let queueTimeout;

        // Utility function to check if an element is visible and contains valid text
        function isVisible(element) {
            const style = window.getComputedStyle(element);
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                element.offsetHeight > 0 &&
                element.offsetWidth > 0 &&
                element.textContent.trim().length > 0 && // Only non-empty text
                !element.textContent.includes('--') &&  // Exclude CSS variables
                !isNonTextElement(element)              // Exclude icons, images, and invalid elements
            );
        }

        // Function to check if an element is a non-textual element (icons, images, etc.)
        function isNonTextElement(element) {
            const tagName = element.tagName.toLowerCase();
            const excludedTags = ['img', 'svg', 'i', 'picture']; // Common icon/image elements
            return excludedTags.includes(tagName);
        }

        // Refine valid elements check further
        function isValidElement(element) {
            const tagName = element.tagName.toLowerCase();
            const excludedTags = ['style', 'script', 'meta', 'link'];
            return !excludedTags.includes(tagName) && isVisible(element);
        }


        // Function to handle sending texts for translation in batch (max 100 at a time)
        // Update the processTranslationQueue function to handle already processed texts properly
        async function processTranslationQueue() {
            if (isTranslating || translationQueue.length === 0) {
                return; // Exit if translation is already in progress or if the queue is empty
            }

            isTranslating = true; // Set the flag to indicate translation in progress

            // Collect text nodes and corresponding text content
            const { textChunks, nodes } = collectTextNodesInOrder();

            console.log("Text chunks to be sent ----------> ", textChunks);

            // Send the collected texts for translation
            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        { type: 'TRANSLATE_TEXT', texts: textChunks, prompt: prompt },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                console.error("Error sending message to background.js:", chrome.runtime.lastError.message);
                                reject(chrome.runtime.lastError.message);
                            } else {
                                resolve(response);
                            }
                        }
                    );
                });

                console.log("The Response Got from background ------>", response);

                // Check and update the text if translation was successful
                if (response && response.translatedTexts && Array.isArray(response.translatedTexts) && response.translatedTexts.length > 0) {
                    const responseTextChunks = response.translatedTexts.map(translatedResponse => translatedResponse.translatedText);
                    console.log("Response Text Chunks", responseTextChunks);
                    reinsertTranslatedText(nodes, responseTextChunks); // Reinsert translated texts into nodes
                } else {
                    console.error("No translated texts received or incorrect format.");
                }

            } catch (error) {
                console.error("Translation failed:", error);
            }

            // Delay between requests
            await new Promise(resolve => setTimeout(resolve, 2000)); 
            isTranslating = false; // Reset the flag when translation is done

            // If more elements remain in the queue, continue processing
            if (translationQueue.length > 0) {
                processTranslationQueue();
            }
        }

        // Function to correctly handle processed elements
        function collectTextNodesInOrder() {
            const textChunks = [];
            const nodes = [];
            const seenTextNodes = new Set(); // Track already processed text nodes

            function traverseNodes(node) {
                node.childNodes.forEach(child => {
                    if (child.nodeType === Node.TEXT_NODE) {
                        const trimmedText = child.textContent.trim();
                        
                        if (isMeaningfulText(trimmedText) && !seenTextNodes.has(child)) { 
                            textChunks.push(trimmedText);
                            nodes.push({ type: 'text', node: child });
                            seenTextNodes.add(child); // Mark text node as seen
                        }
                    } else if (child.nodeType === Node.ELEMENT_NODE) {
                        nodes.push({ type: 'element', node: child });
                        traverseNodes(child); // Recurse through nested elements
                    }
                });
            }

            translationQueue.forEach(element => traverseNodes(element));

            // After processing, move elements to processedElementsSet
            translationQueue.forEach(element => {
                processedElementsSet.add(element);
                queuedElementsSet.delete(element); // Ensure they're no longer in the queued set
            });
            translationQueue = []; // Clear the queue

            return { textChunks, nodes };
        }


        // New function to check if text is meaningful (not JSON-like or punctuation)
        function isMeaningfulText(text) {
            const scriptPattern = /window\.(performance|console)\./;
            const isPunctuationOnly = /^[.,;:!?(){}[\]]+$/.test(text.trim()); // Exclude punctuation-only text
            const isJSONLike = /[\{\[][^{}]*[\}\]]/.test(text.trim()); // Exclude JSON-like objects or arrays
            const isKeyValueLike = /["']?[\w-]+["']?:\s*[\w"-]+/.test(text.trim()); // Exclude key-value pairs like "key": "value"
            const isConfigLike = /(true|false|\d+|null|undefined)/.test(text.trim()); // Exclude boolean/numeric settings
            const isEmptyOrWhitespace = text.trim().length === 0; // Exclude empty or whitespace-only text
            const isScriptRelated = scriptPattern.test(text.trim());
            // Return true only if it's not JSON-like, config-like, or just punctuation
            if (isScriptRelated) {
                console.log(`Filtered out: ${text}`);
            }
            return !isPunctuationOnly && !isJSONLike && !isKeyValueLike && !isConfigLike && !isEmptyOrWhitespace && !isScriptRelated;
        }


        // Function to reinsert translated text into the same structure
        function reinsertTranslatedText(nodes, translatedTexts) {
            let textIndex = 0;

            nodes.forEach(({ type, node }) => {
                if (type === 'text') {
                    // Check if there are translated texts available
                    if (textIndex < translatedTexts.length) {
                        // Reinsert the translated text into text nodes
                        node.textContent = translatedTexts[textIndex];
                        textIndex++;
                    }
                }
            });
        }

        // Function to batch the queue processing
        function startQueueProcessing() {
            if (queueTimeout) {
                clearTimeout(queueTimeout); // Reset the timeout if it's already set
            }
            queueTimeout = setTimeout(() => {
                processTranslationQueue();
            }, 1000); // Delay of 1 second before processing the queue
        }

        // Observe elements as they come into view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const element = entry.target;

                if (entry.isIntersecting && !queuedElementsSet.has(element) && !processedElementsSet.has(element) && isValidElement(element)) {
                    // Add element to the queue only if it hasn't been added before
                    translationQueue.push(element);
                    // Only add to the set after it's successfully added to the queue
                    queuedElementsSet.add(element);

                    // Start queue processing with delay
                    startQueueProcessing();
                }
            });
        }, observerOptions);

        // Observe all relevant elements (generalize the selector for meaningful elements)
        document.querySelectorAll('div').forEach((element) => {
            observer.observe(element);
        });

        // Monitor for dynamically added elements
        const mutationObserver = new MutationObserver(() => {
            document.querySelectorAll('div').forEach(element => {
                if (!queuedElementsSet.has(element) && !processedElementsSet.has(element) && isValidElement(element)) {
                    observer.observe(element); // Observe any new elements added dynamically
                }
            });
        });

        mutationObserver.observe(document.body, { childList: true, subtree: true });

    }
})
