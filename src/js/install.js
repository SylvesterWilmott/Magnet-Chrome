"use strict";

/* global chrome */

export async function showOnboarding() {
  try {
    const path = "onboarding/html/welcome.html";
    const relativeUrl = chrome.runtime.getURL(path);

    await chrome.tabs.create({ url: relativeUrl });
  } catch (error) {
    handleError(error);
  }
}
