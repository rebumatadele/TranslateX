chrome.storage.local.get(['isEnabled', "language"], (result) => {
    const isEnabled = result.isEnabled ?? true;
    const prompt = result.language;
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

        // Enhanced function to check if an element is visible and contains meaningful text
        function isVisible(element) {
            const style = window.getComputedStyle(element);
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                element.offsetHeight > 0 &&
                element.offsetWidth > 0 &&
                element.textContent.trim().length > 0 && // Only non-empty text
                !element.textContent.includes('--') &&  // Exclude CSS variables
                !isNonTextElement(element) &&             // Exclude icons, images, and invalid elements
                !isNonMeaningfulText(element.textContent) // Additional check for non-meaningful text
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

        // Function to further refine the check for non-meaningful text
        function isNonMeaningfulText(text) {
            const nonMeaningfulPatterns = [
                /\/\/.*$/, // Comments
                /\/\*[\s\S]*?\*\//, // Block comments
                /console\.log\(.+\)/, // Console logs
                /window\.(performance|console)\./ // Script-related patterns
            ];

            return nonMeaningfulPatterns.some(pattern => pattern.test(text.trim()));
        }
        // Function to handle sending texts for translation in batch (max 100 at a time)
        // Function to handle sending texts for translation in batches of 200
        async function processTranslationQueue() {
            if (isTranslating || translationQueue.length === 0) return;
        
            isTranslating = true;
        
            const { textChunks, nodes } = collectTextNodesInOrder();
        
            let currentBatch = [];
            let currentBatchLength = 0;
            const maxBatchLength = 3000; // Max 3000 characters per batch
            const batches = [];
            const nodeBatches = [];
        
            for (let i = 0; i < textChunks.length; i++) {
                const chunkLength = textChunks[i].length;
                
                if (currentBatchLength + chunkLength <= maxBatchLength) {
                    currentBatch.push(textChunks[i]);
                    currentBatchLength += chunkLength;
                } else {
                    batches.push(currentBatch);
                    nodeBatches.push(nodes.slice(i - currentBatch.length, i));
                    currentBatch = [textChunks[i]];
                    currentBatchLength = chunkLength;
                }
            }
        
            if (currentBatch.length > 0) {
                batches.push(currentBatch);
                nodeBatches.push(nodes.slice(nodes.length - currentBatch.length, nodes.length));
            }
        
            // Now send each batch with max 3000 characters
            for (let i = 0; i < batches.length; i++) {
                const textBatch = batches[i];
                const nodesBatch = nodeBatches[i];
                console.log("About to send", textBatch.join(' ').length, "characters");
        
                try {
                    const response = await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage(
                            { type: 'TRANSLATE_TEXT', texts: textBatch, prompt: prompt },
                            (response) => {
                                if (chrome.runtime.lastError) {
                                    console.error("Error:", chrome.runtime.lastError.message);
                                    reject(chrome.runtime.lastError.message);
                                } else {
                                    resolve(response);
                                }
                            }
                        );
                    });
        
                    if (response && response.translatedTexts) {
                        const translatedTexts = response.translatedTexts.map(t => t.translatedText);
                        reinsertTranslatedText(nodesBatch, translatedTexts);
                    }
        
                } catch (error) {
                    console.error("Translation failed:", error);
                }
        
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        
            isTranslating = false;
        
            if (translationQueue.length > 0) {
                processTranslationQueue();
            }
        }
        
        
        // Function to sanitize input by removing control characters
        function sanitizeInput(text) {
            return text.replace(/[\x00-\x1F\x7F]/g, ''); // Removes non-printable characters
        }

        // Function to collect text nodes for translation, avoiding duplicates
        function collectTextNodesInOrder() {
            const textChunks = [];
            const nodes = [];
            const seenTextNodes = new Set();
        
            function traverseNodes(node) {
                node.childNodes.forEach(child => {
                    if (child.nodeType === Node.TEXT_NODE) {
                        let trimmedText = child.textContent.trim();
                        trimmedText = sanitizeInput(trimmedText); // Sanitize the text here

                        if (isMeaningfulText(trimmedText) && !seenTextNodes.has(child) && !processedElementsSet.has(child)) {
                            textChunks.push(trimmedText);
                            nodes.push({ type: 'text', node: child });
                            seenTextNodes.add(child);
                            processedElementsSet.add(child); // Mark this text node as processed
                        }
                    } else if (child.nodeType === Node.ELEMENT_NODE) {
                        traverseNodes(child); // Continue traversing through children
                    }
                });
            }
        
            translationQueue.forEach(element => traverseNodes(element));
            translationQueue.forEach(element => {
                queuedElementsSet.delete(element);
            });
            translationQueue = [];
            return { textChunks, nodes };
        }        

        // Check if text is meaningful (exclude scripts, configs, etc.)
        // Updated function to check if the text is meaningful
        function isMeaningfulText(text) {
            const scriptPattern = /window\.(performance|console)\./;
            const isPunctuationOnly = /^[-.,;:!?(){}[\]]+$/.test(text.trim());
            const isJSONLike = /^[{\[].*[\]}]$/.test(text.trim());
            const isKeyValueLike = /^["']?[\w-]+["']?:\s*["'[\w-]+/.test(text.trim());
            const isConfigLike = /^(true|false|\d+|null|undefined)$/.test(text.trim());
            const isEmptyOrWhitespace = text.trim().length === 0;
            const isScriptRelated = scriptPattern.test(text.trim());
            const isNumbersOnly = /^[\d\s.,;:!?(){}[\]]+$/.test(text.trim()); // Exclude numbers with punctuations
            const isWeatherRelated = /^[\d\s.,;:!?()°CF]+$/.test(text.trim()); // Matches texts with numbers, degree symbols, C/F for weather
            const isCSSLike = /\.?\w[\w-]*\s*{[^}]*}/.test(text.trim()); // Matches CSS-like text patterns
            const isHTMLTag = /<[^>]*>/.test(text.trim()); // Matches HTML tags like <img>, <div>, etc.
            const isComplexScript = /\b(RLQ|mw\.config|limitreport|cputime|walltime|ppvisitednodes|postexpandincludesize|templateargumentsize|expansiondepth|expensivefunctioncount|unstrip-depth|unstrip-size|entityaccesscount|timingprofile)\b/.test(text.trim()); // Matches complex script-related terms

            return !isComplexScript && !isHTMLTag && !isCSSLike && !isWeatherRelated && !isPunctuationOnly && !isJSONLike && !isKeyValueLike && !isConfigLike && !isEmptyOrWhitespace && !isScriptRelated && !isNumbersOnly;
        }

        // Function to reinsert translated text using Range to preserve structure
        function reinsertTranslatedText(nodes, translatedTexts) {
            let textIndex = 0;
            nodes.forEach(({ type, node }) => {
                if (type === 'text' && textIndex < translatedTexts.length) {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    const newText = document.createTextNode(translatedTexts[textIndex]);
                    range.deleteContents();
                    range.insertNode(newText);
                    textIndex++;
                }
            });
        }

        // Start queue processing with a delay
        function startQueueProcessing() {
            if (queueTimeout) clearTimeout(queueTimeout);
            queueTimeout = setTimeout(() => processTranslationQueue(), 1000);
        }

        // IntersectionObserver logic for observing elements in view
        function startObserving() {
            setTimeout(() => {
                // IntersectionObserver logic
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        const element = entry.target;
                        if (entry.isIntersecting && !queuedElementsSet.has(element) && !processedElementsSet.has(element) && isValidElement(element)) {
                            translationQueue.unshift(element); // Add element to the beginning of the queue for LIFO
                            queuedElementsSet.add(element);
                            startQueueProcessing();
                        }
                    });
                    
                }, observerOptions);
        
                document.querySelectorAll('*').forEach(element => observer.observe(element));
        
                // MutationObserver logic
                const mutationObserver = new MutationObserver(() => {
                    document.querySelectorAll('*').forEach(element => {
                        if (!queuedElementsSet.has(element) && !processedElementsSet.has(element) && isValidElement(element)) {
                            observer.observe(element);
                        }
                    });
                });
        
                mutationObserver.observe(document.body, { childList: true, subtree: true });
            }, 3000); // Delay for 3 seconds
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserving);
        } else {
            startObserving();
        }
            
    }
});
