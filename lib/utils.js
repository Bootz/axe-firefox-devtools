/*global XPCOMUtils, gDevTools, gDevToolsBrowser */
var { Cu } = require('chrome');
var Promise = require('sdk/core/promise.js');
const self = require('sdk/self');

Cu.import('resource://gre/modules/XPCOMUtils.jsm');

XPCOMUtils.defineLazyModuleGetter(this, 'gDevTools', 'resource:///modules/devtools/gDevTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'gDevToolsBrowser', 'resource:///modules/devtools/gDevTools.jsm');

const { getMostRecentBrowserWindow } = require('sdk/window/utils');

exports.getThemes = function () {
  return gDevTools.getThemeDefinitionArray();
};

exports.registerDevTool = function (toolDef) {
  gDevTools.registerTool(toolDef);
};

exports.unregisterDevTool = function (toolDef) {
  gDevTools.unregisterTool(toolDef);
};

exports.openDevTool = function(toolId) {
  let activeBrowserWindow = getMostRecentBrowserWindow();
  let { gBrowser } = activeBrowserWindow;
  return gDevToolsBrowser.selectToolCommand(gBrowser, toolId);
};


exports.inspectDOMElement = function (toolbox, selectorArray) {
  return gDevTools.showToolbox(toolbox._target, 'inspector').then(toolbox => {
    let { walker } = toolbox.getCurrentPanel();
    walker.querySelector(walker.rootNode, selectorArray[0])
      .then(function (result) {
        var depth = 1, contentDocument;
        while(result.nodeName === 'IFRAME' && selectorArray.length > depth) {
          contentDocument = result.rawNode().contentDocument;
          result = walker.frontForRawNode(contentDocument.querySelector(selectorArray[depth]));
          depth += 1;
        }
        toolbox.selection.setNodeFront(result);
      });
  });
};
exports.highlightDOMElement = function (toolbox, selectorArray) {
  toolbox.loadTool('inspector').then(function () {
    let { walker } = toolbox.getPanel('inspector');
    walker.querySelector(walker.rootNode, selectorArray[0])
      .then(function (result) {
        var depth = 1, contentDocument;
        while(result.nodeName === 'IFRAME' && selectorArray.length > depth) {
          contentDocument = result.rawNode().contentDocument;
          result = walker.frontForRawNode(contentDocument.querySelector(selectorArray[depth]));
          depth += 1;
        }
        toolbox.highlighterUtils.highlightNodeFront(result);
      });
  });
};


exports.openSource = function(target, url, line) {
   return gDevTools.showToolbox(target, 'jsdebugger').then(toolbox => {
    let dbg = toolbox.getCurrentPanel().panelWin;

    return onSourcesLoaded(dbg).then(() => {
      let { DebuggerView } = dbg;
      let { Sources } = DebuggerView;
      let item = Sources.getItemForAttachment(a => a.source.url === url);
      if (item) {
        let options = { noDebug: true };
        let actor = item.attachment.source.actor;
        // Firefox >= 36
        return DebuggerView.setEditorLocation(actor, line, options).then(null, () => {
          // Firefox <= 35
          return DebuggerView.setEditorLocation(url, line, options);
        });
      } else {
        return Promise.reject('Couldn\'t find the specified source in the debugger.');
      }
    });
  });
};

function onSourcesLoaded(dbg) {
  let { resolve, promise } = Promise.defer();
  let { DebuggerView: { Sources } } = dbg;

  if (Sources.items.length > 0) {
    resolve();
  } else {
    resolve(dbg.once(dbg.EVENTS.SOURCES_ADDED));
  }
  return promise;
}

exports.evaluateFileOnTargetWindow = function(target, fileUrl) {
  let { resolve, reject, promise } = Promise.defer();

  let fileSource = self.data.load(fileUrl);

  // evaluate ember_debug source in the target tab
  // (and resolve/reject accordingly)
  consoleFor(target).
    then(({webconsoleClient, debuggerClient}) => {
      webconsoleClient.evaluateJS(fileSource, (res) => {
        if (res.error || res.exception) {
          reject(res.error, res.exception);
        } else {
          resolve(res);
        }
      }, { url: self.data.url(fileUrl) });
    }, () => reject('consoleFor rejected'));

  return promise;
};

function consoleFor(target) {
  if (!target.client) {
    return target.makeRemote().then(() => {
      consoleFor(target);
    }, (e) => {
      throw e;
    });
  }

  let { client, form: { consoleActor } } = target;

  let { resolve, reject, promise } = Promise.defer();

  client.attachConsole(consoleActor, [], (res, webconsoleClient) => {
    if (res.error) {
      reject(res.error);
    } else {
      resolve({
        webconsoleClient: webconsoleClient,
        debuggerClient: client
      });
    }
  });

  return promise;
}
