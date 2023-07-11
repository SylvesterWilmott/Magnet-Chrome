'use strict'

/* global chrome */

import * as action from './js/action.js'
import * as display from './js/display.js'
import * as menu from './js/menu.js'
import * as message from './js/message.js'
import * as offscreen from './js/offscreen.js'
import * as storage from './js/storage.js'
import * as windows from './js/windows.js'

const throttledplaySound = throttle(playSound, 100)

chrome.runtime.onStartup.addListener(init)
chrome.runtime.onInstalled.addListener(init)
chrome.action.onClicked.addListener(onActionClicked)
chrome.windows.onCreated.addListener(onWindowCreated)
chrome.windows.onRemoved.addListener(onWindowRemoved)
chrome.contextMenus.onClicked.addListener(onMenuClicked)

const parameters = {
  MAIN_WINDOW_RATIO: 0.5,
  WIN_MIN_SIZE: 550,
  MAX_COLUMNS: 3,
  PADDING: 10
}

async function init () {
  try {
    await setupContextMenu()
    await loadPreferences()
    await updateTitle()
  } catch (error) {
    handleError(error)
  }
}

async function updateTitle () {
  try {
    const platformInfo = await getPlatformInfo()
    const extensionTitle = chrome.i18n.getMessage('EXT_NAME_SHORT')
    let shortcut

    if (platformInfo.os === 'mac') {
      shortcut = chrome.i18n.getMessage('SHORTCUT_MAC')
    } else {
      shortcut = chrome.i18n.getMessage('SHORTCUT')
    }

    await action.setTitle(`${extensionTitle} (${shortcut})`)
  } catch (error) {
    handleError(error)
  }
}

function getPlatformInfo () {
  return new Promise((resolve, reject) => {
    chrome.runtime.getPlatformInfo(function (info) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve(info)
    })
  })
}

async function setupContextMenu () {
  try {
    const storedPreferences = await storage.load(
      'preferences',
      storage.preferenceDefaults
    )

    const menuItems = buildMenuStructure(storedPreferences)

    await menu.create(menuItems)
  } catch (error) {
    handleError(error)
  }
}

function buildMenuStructure (preferences) {
  const menuStructure = []

  Object.entries(preferences).forEach(([key, preference]) => {
    if (preference.type === 'checkbox') {
      const menuItem = {
        title: preference.title,
        contexts: ['action'],
        id: key,
        type: 'checkbox'
      }
      menuStructure.push(menuItem)
    }

    if (preference.type === 'select') {
      const parentItem = {
        title: preference.title,
        contexts: ['action'],
        id: key,
        type: 'normal'
      }
      menuStructure.push(parentItem)

      preference.options.forEach((option) => {
        const childItem = {
          title: option.charAt(0).toUpperCase() + option.slice(1),
          contexts: ['action'],
          id: option,
          type: 'radio',
          parentId: key
        }
        menuStructure.push(childItem)
      })
    }
  })

  return menuStructure
}

async function loadPreferences () {
  try {
    const storedPreferences = await storage.load(
      'preferences',
      storage.preferenceDefaults
    )

    for (const [preferenceName, preferenceObj] of Object.entries(
      storedPreferences
    )) {
      if (preferenceObj.type === 'select') {
        await menu.update(preferenceObj.status, true)
      } else if (preferenceObj.type === 'checkbox') {
        await menu.update(preferenceName, preferenceObj.status)
      } else if (preferenceObj.type === 'action') {
        updateIcon(preferenceObj.status)
      }
    }
  } catch (error) {
    handleError(error)
  }
}

async function onMenuClicked (info, tab) {
  const { menuItemId, parentMenuItemId } = info

  try {
    const storedPreferences = await storage.load(
      'preferences',
      storage.preferenceDefaults
    )

    const preference = storedPreferences[menuItemId]
    const parentPreference = storedPreferences[parentMenuItemId]

    if (!preference && !parentPreference) {
      return
    }

    if (parentPreference && parentPreference.type === 'select') {
      parentPreference.status = menuItemId
    } else if (preference.type === 'checkbox') {
      preference.status = info.checked
    }

    await storage.save('preferences', storedPreferences)

    if (
      parentMenuItemId === 'main_window' &&
      storedPreferences.enabled.status === true &&
      tab.windowId
    ) {
      const win = await windows.get(tab.windowId)
      await updateTiling(win)
    }
  } catch (error) {
    handleError(error)
  }
}

async function onActionClicked (tab) {
  try {
    const storedPreferences = await storage.load(
      'preferences',
      storage.preferenceDefaults
    )
    storedPreferences.enabled.status = !storedPreferences.enabled.status

    await updateIcon(storedPreferences.enabled.status)

    await storage.save('preferences', storedPreferences)

    if (!tab.windowId) {
      return
    }

    if (storedPreferences.enabled.status === true) {
      const win = await windows.get(tab.windowId)
      await updateTiling(win)

      if (storedPreferences.sounds.status === true) {
        throttledplaySound('on')
      }
    } else {
      if (storedPreferences.sounds.status === true) {
        throttledplaySound('off')
      }
    }
  } catch (error) {
    handleError(error)
  }
}

async function updateTiling (win) {
  try {
    const storedPreferences = await storage.load(
      'preferences',
      storage.preferenceDefaults
    )

    if (
      storedPreferences.main_window.status === 'left' ||
      storedPreferences.main_window.status === 'right'
    ) {
      await tileWindowsWithMain(win)
    } else {
      await tileWindows(win)
    }
  } catch (error) {
    handleError(error)
  }
}

async function updateIcon (state) {
  try {
    const path = chrome.runtime.getURL(
      `images/icon32${state ? '_active' : ''}.png`
    )
    await action.setIcon(path)
  } catch (error) {
    handleError(error)
  }
}

async function onWindowCreated (win) {
  try {
    await startTileProcess(win)
  } catch (error) {
    handleError(error)
  }
}

async function onWindowRemoved () {
  try {
    const allWindows = await windows.getWindows()
    const allDisplays = await display.getDisplayInfo()

    if (allWindows.length === 1 || allDisplays.length === 1) {
      await startTileProcess(allWindows[0])
      return
    }

    const displayIds = []

    for (const win of allWindows) {
      const displayContainingWin = display.getDisplayContainingWindow(
        allDisplays,
        win
      )
      displayIds.push(displayContainingWin.id)
    }

    const counts = {}
    let maxCount = 0
    let mostFrequentId = null

    for (const id of displayIds) {
      counts[id] = (counts[id] || 0) + 1
      if (counts[id] > maxCount) {
        maxCount = counts[id]
        mostFrequentId = id
      }
    }

    if (mostFrequentId) {
      for (const win of allWindows) {
        const displayContainingWin = display.getDisplayContainingWindow(
          allDisplays,
          win
        )

        if (displayContainingWin.id === mostFrequentId) {
          await startTileProcess(win)
          break
        }
      }
    } else {
      await startTileProcess(allWindows[0])
    }
  } catch (error) {
    handleError(error)
  }
}

async function startTileProcess (win) {
  try {
    const storedPreferences = await storage.load(
      'preferences',
      storage.preferenceDefaults
    )

    if (!storedPreferences.enabled.status) {
      // Extension is disabled
      return
    }

    if (
      storedPreferences.main_window.status === 'left' ||
      storedPreferences.main_window.status === 'right'
    ) {
      await tileWindowsWithMain(win)
    } else {
      await tileWindows(win)
    }
  } catch (error) {
    handleError(error)
  }
}

async function tileWindows (win) {
  try {
    const allWindows = await windows.getWindows()
    const visibleNormalWindows = allWindows.filter(
      (window) => window.type === 'normal' && window.state !== 'minimized'
    );
    const totalNumberOfWindows = visibleNormalWindows.length

    if (totalNumberOfWindows === 0) {
      return
    }

    // If any windows are fullscreen or minimized then set them as normal before tiling
    await normalizeWindowStates(visibleNormalWindows)

    let numberOfRows
    let numberOfColumns

    const squareRoot = Math.ceil(Math.sqrt(totalNumberOfWindows))

    if (totalNumberOfWindows === 1) {
      numberOfRows = 1
      numberOfColumns = 1
    } else if (totalNumberOfWindows % parameters.MAX_COLUMNS === 0) {
      numberOfRows = totalNumberOfWindows / parameters.MAX_COLUMNS
      numberOfColumns = parameters.MAX_COLUMNS
    } else if (squareRoot * squareRoot === totalNumberOfWindows) {
      numberOfRows = squareRoot
      numberOfColumns = squareRoot
    } else {
      numberOfRows = Math.ceil(totalNumberOfWindows / parameters.MAX_COLUMNS)
      numberOfColumns = Math.min(totalNumberOfWindows, parameters.MAX_COLUMNS)
    }

    const allDisplays = await display.getDisplayInfo()

    let targetDisplay

    if (!win || allDisplays.length === 1) {
      targetDisplay = allDisplays[0]
    } else {
      targetDisplay = display.getDisplayContainingWindow(allDisplays, win)
    }

    const displayWorkArea = targetDisplay?.workArea

    if (!displayWorkArea) {
      throw new Error('Unable to retrieve display information.')
    }

    const tilingData = calculateTilingData(
      numberOfRows,
      numberOfColumns,
      displayWorkArea
    )

    const winUpdates = []

    for (const w of visibleNormalWindows) {
      const index = visibleNormalWindows.indexOf(w)
      if (index !== -1) {
        const { id } = w
        winUpdates.push({
          id,
          position: tilingData.positions[index]
        })
      } else {
        throw new Error(`No index found for window with ID ${window.id}`)
      }
    }

    for (const w of winUpdates) {
      const win = await windows.get(w.id)
      const currentPosition = {
        top: win.top,
        left: win.left,
        height: win.height,
        width: win.width
      }
      const positonIsSame = compareWindowExpectedSize(w.position, currentPosition)

      if (!positonIsSame) {
        await windows.setWindow(w.id, w.position)
      }
    }
  } catch (error) {
    handleError(error)
  }
}

async function tileWindowsWithMain (win) {
  try {
    const allWindows = await windows.getWindows()
    const visibleNormalWindows = allWindows.filter(
      (window) => window.type === 'normal' && window.state !== 'minimized'
    );
    const totalNumberOfWindows = visibleNormalWindows.length

    if (totalNumberOfWindows === 0) {
      return
    }

    await normalizeWindowStates(visibleNormalWindows)

    let numberOfRows
    let numberOfColumns

    const squareRoot = Math.ceil(Math.sqrt(totalNumberOfWindows - 1))

    const allDisplays = await display.getDisplayInfo()

    const targetDisplay = display.getDisplayContainingWindow(allDisplays, win)
    const displayWorkArea = targetDisplay?.workArea

    if (!displayWorkArea) {
      throw new Error('Unable to retrieve display information.')
    }

    const mainWindowSize = calculateMainWindowSize(
      totalNumberOfWindows,
      displayWorkArea
    )

    const mainPosition = {
      top: Math.floor(displayWorkArea.top + parameters.PADDING),
      left: null,
      width: Math.floor(mainWindowSize.width),
      height: Math.floor(displayWorkArea.height - 2 * parameters.PADDING)
    }

    const storedPreferences = await storage.load(
      'preferences',
      storage.preferenceDefaults
    )

    if (storedPreferences.main_window.status === 'left') {
      mainPosition.left = Math.floor(displayWorkArea.left + parameters.PADDING)
    } else if (storedPreferences.main_window.status === 'right') {
      mainPosition.left = Math.floor(
        displayWorkArea.left +
          displayWorkArea.width -
          mainWindowSize.width -
          parameters.PADDING
      )
    }

    const remainingSpace = {
      top: displayWorkArea.top,
      left: null,
      width: displayWorkArea.width - mainWindowSize.width - parameters.PADDING,
      height: displayWorkArea.height
    }

    if (storedPreferences.main_window.status === 'left') {
      remainingSpace.left =
        displayWorkArea.left + mainWindowSize.width + parameters.PADDING
    } else if (storedPreferences.main_window.status === 'right') {
      remainingSpace.left = displayWorkArea.left
    }

    const maxColumnsBasedOnSpace = Math.floor(
      remainingSpace.width / (parameters.WIN_MIN_SIZE + parameters.PADDING)
    )
    const maxColumns = Math.min(
      maxColumnsBasedOnSpace,
      parameters.MAX_COLUMNS - 1
    )

    if (totalNumberOfWindows - 1 === 1) {
      numberOfRows = 1
      numberOfColumns = 1
    } else if ((totalNumberOfWindows - 1) % maxColumns === 0) {
      numberOfRows = (totalNumberOfWindows - 1) / maxColumns
      numberOfColumns = maxColumns
    } else if (squareRoot * squareRoot === totalNumberOfWindows - 1) {
      numberOfRows = squareRoot
      numberOfColumns = squareRoot
    } else {
      numberOfRows = Math.ceil((totalNumberOfWindows - 1) / maxColumns)
      numberOfColumns = Math.min(totalNumberOfWindows - 1, maxColumns)
    }

    const tilingData = calculateTilingData(
      numberOfRows,
      numberOfColumns,
      remainingSpace
    )

    const winUpdates = []

    for (const w of visibleNormalWindows) {
      const index = visibleNormalWindows.indexOf(w)
      if (index !== -1) {
        const { id } = w

        const position =
          index === 0 ? mainPosition : tilingData.positions[index - 1]
        winUpdates.push({
          id,
          position
        })
      } else {
        throw new Error(`No index found for window with ID ${window.id}`)
      }
    }

    for (const w of winUpdates) {
      const win = await windows.get(w.id)
      const currentPosition = {
        top: win.top,
        left: win.left,
        height: win.height,
        width: win.width
      }
      const positonIsSame = compareWindowExpectedSize(w.position, currentPosition)

      if (!positonIsSame) {
        await windows.setWindow(w.id, w.position)
      }
    }
  } catch (error) {
    handleError(error)
  }
}

function compareWindowExpectedSize(pos1, pos2) {
  const keys1 = Object.keys(pos1);

  for (const key of keys1) {
    if (pos1[key] !== pos2[key]) {
      return false;
    }
  }

  return true;
}

async function normalizeWindowStates(windows) {
  for (const w of windows) {
    if (w.state && w.state === 'fullscreen') {
      await windows.updateState(w.id, 'normal')
    }
  }
}

function calculateTilingData (numberOfRows, numberOfColumns, displayWorkArea) {
  const tilingData = {
    rowSizes: [],
    columnSizes: [],
    positions: []
  }

  const totalPaddingWidth = (numberOfColumns + 1) * parameters.PADDING
  const totalPaddingHeight = (numberOfRows + 1) * parameters.PADDING

  const rowSize = Math.floor(
    (displayWorkArea.height - totalPaddingHeight) / numberOfRows
  )
  const columnSize = Math.floor(
    (displayWorkArea.width - totalPaddingWidth) / numberOfColumns
  )

  for (let row = 0; row < numberOfRows; row++) {
    tilingData.rowSizes.push(rowSize)
  }

  for (let column = 0; column < numberOfColumns; column++) {
    tilingData.columnSizes.push(columnSize)
  }

  const availableWidth = displayWorkArea.width - totalPaddingWidth
  const availableHeight = displayWorkArea.height - totalPaddingHeight

  const adjustedColumnSize = Math.floor(availableWidth / numberOfColumns)
  const adjustedRowSize = Math.floor(availableHeight / numberOfRows)

  let topOffset = displayWorkArea.top + parameters.PADDING

  for (let row = 0; row < numberOfRows; row++) {
    let leftOffset = displayWorkArea.left + parameters.PADDING

    for (let column = 0; column < numberOfColumns; column++) {
      const position = {
        top: Math.floor(topOffset),
        left: Math.floor(leftOffset),
        width: Math.floor(adjustedColumnSize),
        height: Math.floor(adjustedRowSize)
      }

      tilingData.positions.push(position)
      leftOffset += adjustedColumnSize + parameters.PADDING
    }

    topOffset += adjustedRowSize + parameters.PADDING
  }

  return tilingData
}

function calculateMainWindowSize (totalNumberOfWindows, displayWorkArea) {
  const availableWidth = displayWorkArea.width - parameters.PADDING * 2
  const availableHeight = displayWorkArea.height - parameters.PADDING * 2

  let mainWindowWidth, mainWindowHeight

  if (totalNumberOfWindows === 1) {
    mainWindowWidth = availableWidth
    mainWindowHeight = availableHeight
  } else {
    const ratio = parameters.MAIN_WINDOW_RATIO
    mainWindowWidth = Math.floor(availableWidth * ratio)
    mainWindowHeight = Math.floor(availableHeight)
  }

  return {
    width: mainWindowWidth,
    height: mainWindowHeight
  }
}

async function playSound (sound) {
  try {
    const documentPath = 'offscreen.html'
    const hasDocument = await offscreen.hasDocument(documentPath)

    if (!hasDocument) {
      await offscreen.create(documentPath)
    }

    message.sendSync({ type: 'play-sound', target: 'offscreen', sound })
  } catch (error) {
    handleError(error)
  }
}

function throttle (func, delay) {
  let lastExecTime = 0
  return function () {
    const context = this
    const args = arguments
    const now = Date.now()
    if (now - lastExecTime >= delay) {
      lastExecTime = now
      func.apply(context, args)
    }
  }
}

function handleError (error) {
  console.error('An error occurred:', error)
}
