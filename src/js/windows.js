'use strict'

/* global chrome */

export function getWindows () {
  return new Promise((resolve, reject) => {
    chrome.windows.getAll(function (windows) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve(windows)
    })
  })
}

export function setWindow (id, obj) {
  return new Promise((resolve, reject) => {
    chrome.windows.update(
      id,
      {
        height: obj.height,
        width: obj.width,
        top: obj.top,
        left: obj.left,
        state: 'normal'
      },
      function () {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message)
        }
        resolve()
      }
    )
  })
}

export function get (windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.get(windowId,
      function (win) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message)
        }
        resolve(win)
      }
    )
  })
}
