"use strict";

/* global chrome */

document.addEventListener("DOMContentLoaded", init);

async function init() {
  localize();
  registerListeners();
  ready();
}

function localize() {
  const strings = document.querySelectorAll("[data-localize]");

  if (strings) {
    for (const s of strings) {
      s.innerText = chrome.i18n.getMessage(s.dataset.localize);
    }
  }
}

function registerListeners() {
  document.getElementById('dismiss').addEventListener('click', onDissmissClicked, false)
}

function onDissmissClicked() {
  window.close()
}

function ready() {
  document.title = chrome.i18n.getMessage('WELCOME');
  document.getElementById("version").innerText = `v${chrome.runtime.getManifest().version}`;
  document.getElementById("container").classList.remove('hidden')
}