document.addEventListener('DOMContentLoaded', function() {
    const toggle = document.getElementById('toggle');
    const toggleBg = document.querySelector('.toggle-bg');
    const toggleThumb = document.querySelector('.toggle-thumb');
    const languageInput = document.getElementById('language-input');
    const refreshButton = document.getElementById('refresh-button');

    // Load the current state and input value
    chrome.storage.local.get(['isEnabled', 'language'], (result) => {
        const isEnabled = result.isEnabled ?? true;
        const language = result.language ?? '';

        toggle.checked = isEnabled;
        languageInput.value = language;

        if (isEnabled) {
            toggleBg.classList.add('active');
            toggleThumb.classList.add('active');
        } else {
            toggleBg.classList.remove('active');
            toggleThumb.classList.remove('active');
        }
    });

    // Handle toggle state and language input
    toggle.addEventListener('change', function() {
        const isEnabled = toggle.checked;
        if (isEnabled) {
            toggleBg.classList.add('active');
            toggleThumb.classList.add('active');
        } else {
            toggleBg.classList.remove('active');
            toggleThumb.classList.remove('active');
        }
        // Update storage to reflect the new state
        chrome.storage.local.set({ isEnabled });

        // Send a message to the background script to update the state
        chrome.runtime.sendMessage({ action: 'toggle', isEnabled })
    });

    // Handle input field submission
    languageInput.addEventListener('change', function() {
        const language = languageInput.value;
        // Update storage with the new language value
        chrome.storage.local.set({ language });
        console.log('Language input value: ', language); // Debugging line

        // Send the new language prompt to the background script
        chrome.runtime.sendMessage({ action: 'setLanguage', language })
    });

    // Handle refresh button click
    refreshButton.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.reload(tabs[0].id);
            }
        });
    });
});
