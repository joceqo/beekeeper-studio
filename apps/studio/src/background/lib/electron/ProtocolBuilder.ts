import { protocol } from 'electron'
import * as path from 'path'
import { readFile } from 'fs'
import * as fs from 'fs'
import { URL } from 'url'
import rawLog from '@bksLogger'
import platformInfo from '@/common/platform_info'
import bksConfig from "@/common/bksConfig";

const log = rawLog.scope('ProtocolBuilder')

function mimeTypeOf(pathName: string) {
  const extension = path.extname(pathName).toLowerCase()
  if (extension === '.js' || extension === '.mjs') {
    return 'text/javascript'
  } else if (extension === '.html') {
    return 'text/html'
  } else if (extension === '.css') {
    return 'text/css'
  } else if (extension === '.svg' || extension === '.svgz') {
    return 'image/svg+xml'
  } else if (extension === '.json') {
    return 'application/json'
  } else if (extension === '.wasm') {
    return 'application/wasm'
  } else if (extension === '.map') {
    return 'application/json'
  }
}

// Serve a static SPA from `rootDir` over a standard+secure scheme. Used for
// both the Vue (`app://`) and React (`app-react://`) renderers. A custom scheme
// is required instead of `file://` because Chromium blocks ES module scripts
// loaded over file:// (null origin / CORS), which shows up as a white screen.
function registerStaticProtocol(scheme: string, getRootDir: () => string) {
  protocol.registerBufferProtocol(scheme, (request, respond) => {
    let pathName = new URL(request.url).pathname
    pathName = decodeURI(pathName) // Needed in case URL contains spaces

    const emptySourceMap = JSON.stringify({
      version: 3,
      file: request.url,
      sources: [],
      names: [],
      mappings: ''
    });

    // Resolve under the renderer root and refuse anything that escapes it.
    const distRoot = path.resolve(getRootDir())
    const normalizedPath = path.resolve(path.join(distRoot, pathName))
    log.debug("resolving", pathName, 'to', normalizedPath)
    const extension = path.extname(pathName).toLowerCase()

    if (
      normalizedPath !== distRoot &&
      !normalizedPath.startsWith(distRoot + path.sep)
    ) {
      if (extension === '.map') {
        respond({
          mimeType: 'application/json',
          data: Buffer.from(emptySourceMap),
        })
        return
      }
      respond({ error: -6 })
      return
    }

    readFile(normalizedPath, (error, data) => {
      if (error && extension === '.map') {
        respond({
          mimeType: 'application/json',
          data: Buffer.from(emptySourceMap),
        })
        return
      }
      respond({
        mimeType: mimeTypeOf(pathName),
        data,
      })
    })
  })
}

export const ProtocolBuilder = {

  // app:// loads the Vue renderer from dist/renderer (inside app.asar)
  createAppProtocol: () => {
    registerStaticProtocol('app', () => path.join(__dirname, 'renderer'))
  },

  // app-react:// loads the studio-react renderer, shipped via extraResources to
  // <resources>/studio-react (electron-builder-config.js). Mirrors app:// so the
  // React renderer gets a real secure origin and its ES modules load.
  createReactProtocol: () => {
    registerStaticProtocol('app-react', () => path.join(process.resourcesPath, 'studio-react'))
  },
  createPluginProtocol: () => {
    protocol.registerBufferProtocol("plugin", (request, respond) => {
      // Removes the leading "plugin://" and the query string
      const url = new URL(request.url);
      const pluginId = url.host;
      const pathName = path.join(pluginId, url.pathname);
      const pluginsRoot = path.resolve(platformInfo.pluginsDirectory)
      const pluginRoot = path.resolve(path.join(pluginsRoot, pluginId))
      const fullPath = path.resolve(path.join(pluginsRoot, pathName))
      log.debug("resolving", pathName, 'to', fullPath)
      // Containment check: refuse anything that escapes the plugin's own directory.
      if (
        fullPath !== pluginRoot &&
        !fullPath.startsWith(pluginRoot + path.sep)
      ) {
        respond({ error: -6 }) // file not found
        return;
      }
      if (bksConfig.get(`plugins.${pluginId}.disabled`)) {
        respond({ error: -20 }) // blocked by client
        return;
      }
      readFile(fullPath, (error, data) => {
        if (error) {
          log.error("error loading plugin file", pathName, error)
          if (error.code?.toLowerCase() === 'enoent') {
            respond({ error: -6 })
          } else {
            respond({ error: -2 })
          }
          return
        }

        const headers = {}
        headers['Cache-Control'] = 'no-cache'
        headers['Pragma'] = 'no-cache'
        headers['Expires'] = '0'

        const response: any = {
          mimeType: mimeTypeOf(pathName),
          data,
        };
        if (Object.keys(headers).length > 0) {
          response.headers = headers;
        }
        respond(response);
      })
    });
  }
}
