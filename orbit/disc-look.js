(() => {
    const key = 'moire.disc-look.v1';
    const maxTokenLength = 1_400_000;
    const scaled = /^(cellCount|cellSize|cellSizeOscDepth|stroke|warpStrength|layer[123]Offset[XY])$/;
    const patternField = /^(shape|blendMode|blendStrength|bgColor|cutout|cellCount|cellSize|cellSizeOscSpeed|cellSizeOscDepth|stroke|warpType|warpStrength|warpRadius|warpOscSpeed|warpRgbDrive|warpLayers|animateWarp|meshStrength|meshMode|arm[A-Z]\w*|layer[123](Color|Speed|Offset[XY]|Opacity|On|RgbShift))$/;
    const isColour = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
    const origins = [...new Set(['http://localhost:8080', 'http://localhost:8090', location.origin])];   // the live site is one origin
    const sizes = [['S100', 100.8], ['S150', 150.4], ['S250', 249.6], ['S300', 300]];

    function cleanParams(values) {
        return Object.fromEntries(Object.entries(values ?? {}).filter(([name, value]) => patternField.test(name)
            && (typeof value === 'boolean' || Number.isFinite(value) || typeof value === 'string' && value.length < 40
                || name === 'warpLayers' && Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'boolean'))));
    }

    function capture({ params, meshPoints, importedSVG, layerAngle, span, diameter, count, colours, draw }) {
        const layers = [0, 1, 2].map((index) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 512;
            const ctx = canvas.getContext('2d');
            ctx.beginPath();
            ctx.arc(256, 256, 255.5, 0, Math.PI * 2);
            ctx.clip();
            draw(ctx, index);
            const n = index + 1;
            return { mask: canvas.toDataURL('image/png'), enabled: params[`layer${n}On`] !== false,
                colour: isColour(colours?.[index]) ? colours[index] : params[`layer${n}Color`] || '#ffffff' };
        });
        return { v: 1, span, diameter, count, layers, layerAngle: [...layerAngle],
            params: cleanParams(params), meshPoints, importedSVG: params.shape === 'svg-import' ? importedSVG : null };
    }

    function applyState(look, destination, canvasSpan) {
        const params = {};
        for (const [name, value] of Object.entries(cleanParams(look.params))) {
            if (!Object.hasOwn(destination, name) || typeof value !== typeof destination[name]) continue;
            if (name === 'shape' && ![...document.getElementById('shape').options].some(option => option.value === value)) continue;
            params[name] = scaled.test(name) && Number.isFinite(value)
                ? Math.max(name === 'cellCount' ? 1 : -1000, Math.min(1600, value * canvasSpan / Math.max(1, look.span))) : value;
        }
        return { params, meshPoints: look.meshPoints, layerAngle: look.layerAngle };
    }

    function validate(look) {
        if (look?.v !== 1 || !Number.isFinite(look.span) || look.span < 1 || !Array.isArray(look.layers) || look.layers.length !== 3
            || !Array.isArray(look.layerAngle) || look.layerAngle.length !== 3 || !look.layerAngle.every(Number.isFinite)
            || !look.layers.every(layer => isColour(layer.colour) && typeof layer.enabled === 'boolean'
                && typeof layer.mask === 'string' && /^data:image\/png;base64,[\w+/]+=*$/.test(layer.mask))) return null;
        look.params = cleanParams(look.params);
        return look;
    }

    async function encode(look) {
        const stream = new Blob([JSON.stringify(look)]).stream().pipeThrough(new CompressionStream('gzip'));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        let raw = '';
        for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const token = btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
        if (token.length > maxTokenLength) throw new Error('This disc design is too large to transfer.');
        return token;
    }

    async function read(hash) {
        const token = new URLSearchParams(hash.replace(/^#(?:model|design)?&?/, '')).get('look');
        if (!token) return null;
        try {
            if (token === 'current') return validate(JSON.parse(sessionStorage.getItem(key)));
            if (token.length > maxTokenLength || !/^[\w-]+$/.test(token)) return null;
            const bytes = Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            const look = validate(await new Response(stream).json());
            if (look) {
                try {
                    sessionStorage.setItem(key, JSON.stringify(look));
                    history.replaceState(history.state, '', location.pathname + location.search + hash.replace(token, 'current'));
                } catch { /* Keep the complete link if session storage is full. */ }
            }
            return look;
        } catch { return null; }
    }

    function sendToPeer(origin, look) {
        return new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            frame.hidden = true;
            const complete = (error) => {
                clearTimeout(timeout);
                window.removeEventListener('message', onMessage);
                frame.remove();
                if (error) reject(error);
                else resolve();
            };
            const onMessage = event => {
                if (event.origin !== origin || event.source !== frame.contentWindow) return;
                if (event.data?.type === 'moire-look-ready') frame.contentWindow.postMessage({ type: 'moire-look', look }, origin);
                if (event.data?.type === 'moire-look-saved') complete(event.data.ok ? null : new Error('Could not store the disc design.'));
            };
            const timeout = setTimeout(() => complete(new Error('The other project did not respond.')), 4000);
            window.addEventListener('message', onMessage);
            frame.src = `${origin}/disc-look-bridge.html`;
            document.body.appendChild(frame);
        });
    }

    function receiveFromPeer() {
        const origin = origins.find(peer => peer !== location.origin);
        if (!origins.includes(location.origin) || parent === window) return;
        window.addEventListener('message', event => {
            if (event.origin !== origin || event.source !== parent || event.data?.type !== 'moire-look') return;
            let ok = false;
            const look = validate(event.data.look);
            if (look) {
                try { sessionStorage.setItem(key, JSON.stringify(look)); ok = true; } catch { /* Source can send a full link. */ }
            }
            parent.postMessage({ type: 'moire-look-saved', ok }, origin);
        });
        parent.postMessage({ type: 'moire-look-ready' }, origin);
    }

    async function link(target, look, choices = {}) {
        const url = new URL(target.href, location.href);
        if (!origins.includes(url.origin)) return Promise.reject(new Error('Open both local projects before transferring the discs.'));
        const parameters = new URLSearchParams(choices);
        if (url.pathname.endsWith('/model.html') && (url.port === '8080' || url.pathname.endsWith('/orbit/model.html'))) {
            if (Number.isFinite(look.diameter)) {
                const size = sizes.reduce((a, b) => Math.abs(a[1] - look.diameter) <= Math.abs(b[1] - look.diameter) ? a : b);
                parameters.set('size', size[0]);
            }
        }
        let token = 'current';
        try {
            if (url.origin === location.origin) sessionStorage.setItem(key, JSON.stringify(look));
            else await sendToPeer(url.origin, look);
        } catch { token = await encode(look); }
        parameters.set('look', token);
        const page = url.hash === '#model' ? 'model&' : '';
        url.hash = page + parameters;
        return url;
    }

    function bind(anchor, getLook, getChoices) {
        if (!anchor) return;
        anchor.addEventListener('click', async event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (anchor.getAttribute('aria-busy') === 'true') return;
            anchor.setAttribute('aria-busy', 'true');
            try { location.assign(await link(anchor, await getLook(), getChoices?.())); }
            catch (error) { window.alert(error.message); }
            finally { anchor.removeAttribute('aria-busy'); }
        });
    }

    window.MoireLook = { capture, applyState, read, bind, receiveFromPeer };
})();
