document.addEventListener('DOMContentLoaded', function() {
    const toggle = document.getElementById('toggle');
    const toggleBg = document.querySelector('.toggle-bg');
    const toggleThumb = document.querySelector('.toggle-thumb');
    const languageInput = document.getElementById('language-input');
    const restrictedWebsitesInput = document.getElementById('restricted-websites');
    const refreshButton = document.getElementById('refresh-button');

    // Load the current state and input values
    chrome.storage.local.get(['isEnabled', 'language', 'restrictedWebsites'], (result) => {
        const isEnabled = Boolean(result.isEnabled ?? true); // Ensure isEnabled is a boolean
        const language = result.language ?? '';
        const restrictedWebsites = result.restrictedWebsites ?? '';

        toggle.checked = isEnabled;
        languageInput.value = language;
        restrictedWebsitesInput.value = restrictedWebsites;

        if (isEnabled) {
            toggleBg.classList.add('active');
            toggleThumb.classList.add('active');
        } else {
            toggleBg.classList.remove('active');
            toggleThumb.classList.remove('active');
        }
    });

    // Handle toggle state
    toggle.addEventListener('change', function() {
        const isEnabled = toggle.checked;
        chrome.storage.local.set({ isEnabled: Boolean(isEnabled) }); // Ensure isEnabled is stored as a boolean
        chrome.runtime.sendMessage({ action: 'toggle', isEnabled: Boolean(isEnabled) });

        if (isEnabled) {
            toggleBg.classList.add('active');
            toggleThumb.classList.add('active');
        } else {
            toggleBg.classList.remove('active');
            toggleThumb.classList.remove('active');
        }
    });

    // Handle language input field
    languageInput.addEventListener('change', function() {
        const language = languageInput.value;
        chrome.storage.local.set({ language });
        chrome.runtime.sendMessage({ action: 'setLanguage', language });
    });

    // Handle restricted websites input
    restrictedWebsitesInput.addEventListener('change', function() {
        const restrictedWebsites = restrictedWebsitesInput.value;
        chrome.storage.local.set({ restrictedWebsites });
        chrome.runtime.sendMessage({ action: 'setRestrictions', restrictedWebsites });
    });

    // Handle refresh button click
    refreshButton.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.reload(tabs[0].id, () => {
                    window.close();
                });
            }
        });
    });
});