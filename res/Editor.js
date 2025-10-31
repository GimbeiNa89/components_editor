export class Editor {
    constructor(id) {
        this.id = id;

        this.svgCanvas = null;
        this._coordSvg = null;
        this.partsContainer = null;

        this.diagram = { parts: [], connections: [] };

        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;

        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;

        this.draggingPart = null;
        this.dragPartOffsetX = 0;
        this.dragPartOffsetY = 0;

        this.draggingWireDot = null;
        this.dragDotOffsetX = 0;
        this.dragDotOffsetY = 0;

        this.SNAP_THRESHOLD = 15;
        this.WIRE_SELECTION_THRESHOLD = 8;

        this.pendingWire = { startPinId: null, tempSvg: null, tempLine: null, startX: 0, startY: 0 };

        this._selectedWireKey = -1;

        this._partElementCache = {};
        this._pinElementCache = {};

        this._contextMenu = null;
        this._contextData = {};
        this._wireZIndexCounter = 100;

        this._availableComponents = []; 
        this._componentSelectorModal = null; 

        this._initCanvas();
        this._setupDragListeners();
        this._setupWireListeners();

        this._setupCanvasListeners();

        this._initContextMenu();
        this._initComponentSelectorModal(); 
        this._loadAvailableComponents(); 
    }

    getContainer() { return document.getElementById(this.id); }
    getWireContainer() { return this.svgCanvas; }
    getPartsContainer() { return this.partsContainer; }
    _ns(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
    _getPartElement(partId) {
        if (!this._partElementCache[partId]) this._partElementCache[partId] = this.getPartsContainer().querySelector(`[data-part-id="${partId}"]`);
        return this._partElementCache[partId];
    }
    _getPinElement(partId, pinName) {
        const id = `${partId}:${pinName}`;
        if (!this._pinElementCache[id]) {
            const elPart = this._getPartElement(partId);

            if (elPart) this._pinElementCache[id] = elPart.querySelector(`.Pin[pin-id="${pinName}"]`);
        }
        return this._pinElementCache[id];
    }
    _getPinPosition(pinId) {
        const [partId, pinName] = pinId.split(':');
        const el_part = this._getPartElement(partId); if (!el_part) return { x: 0, y: 0 };
        const el_pin = this._getPinElement(partId, pinName); if (!el_pin) return { x: 0, y: 0 };
        const pinRect = el_pin.getBoundingClientRect();
        const containerRect = this.getContainer().getBoundingClientRect();

        let x_abs = (pinRect.left - containerRect.left + pinRect.width / 2);
        let y_abs = (pinRect.top - containerRect.top + pinRect.height / 2);

        const x = (x_abs - this.translateX) / this.scale;
        const y = (y_abs - this.translateY) / this.scale;

        return { x, y };
    }
    _getDiagramCoordinates(e) {
        const containerRect = this.getContainer().getBoundingClientRect();
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        const diagX = (mouseX - this.translateX) / this.scale;
        const diagY = (mouseY - this.translateY) / this.scale;

        return { x: diagX, y: diagY };
    }
    _findWireAtCoordinates(x, y) {
        const THRESHOLD_SQ = this.WIRE_SELECTION_THRESHOLD * this.WIRE_SELECTION_THRESHOLD;
        let closestConnKey = -1;
        let minDistanceSq = Infinity;

        this.diagram.connections.forEach((conn, connKey) => {
            const [pin1Id, pin2Id, , metadataRaw] = conn;
            const metadata = Array.isArray(metadataRaw) ? metadataRaw : [];

            const points = [this._getPinPosition(pin1Id), ...metadata, this._getPinPosition(pin2Id)];

            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i+1];

                const distSq = this._distanceToSegmentSq(x, y, p1.x, p1.y, p2.x, p2.y);

                if (distSq < minDistanceSq) {
                    minDistanceSq = distSq;
                    closestConnKey = connKey;
                }
            }
        });

        if (minDistanceSq <= THRESHOLD_SQ) {
            return closestConnKey;
        }
        return -1;
    }
    _distanceToSegmentSq(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (dx === 0 && dy === 0) {
            return (px - x1) * (px - x1) + (py - y1) * (py - y1);
        }
        const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
        let t_clamped = Math.max(0, Math.min(1, t));

        const closestX = x1 + t_clamped * dx;
        const closestY = y1 + t_clamped * dy;

        return (px - closestX) * (px - closestX) + (py - closestY) * (py - closestY);
    }
    _applyTransform() {
        const transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        this.partsContainer.style.transform = transform;
        this.svgCanvas.style.transform = transform;
        this._updateSvgSize();
    }
    _initCanvas() {
        const container = this.getContainer();
        if (!container) throw new Error('Container not found: ' + this.id);
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

        container.style.userSelect = 'none';

        const wrapper = document.createElement('div');
        wrapper.classList.add('Diagram-Connections');
        wrapper.style.position = 'absolute'; wrapper.style.left = '0px'; wrapper.style.top = '0px';
        wrapper.style.pointerEvents = 'none'; wrapper.style.overflow = 'visible';

        wrapper.style.transformOrigin = '0 0';

        container.appendChild(wrapper);
        this.svgCanvas = wrapper;

        const coordSvg = this._ns('svg');
        coordSvg.setAttribute('width', 0); coordSvg.setAttribute('height', 0);
        coordSvg.style.position = 'absolute'; coordSvg.style.left = '0px'; coordSvg.style.top = '0px';
        coordSvg.style.opacity = '0'; coordSvg.style.pointerEvents = 'none';
        this.svgCanvas.appendChild(coordSvg);
        this._coordSvg = coordSvg;

        const parts = document.createElement('div');
        parts.classList.add('Diagram-Parts');
        parts.style.position = 'absolute'; parts.style.left = '0px'; parts.style.top = '0px';
        parts.style.pointerEvents = 'auto';

        parts.style.transformOrigin = '0 0';

        container.appendChild(parts);
        this.partsContainer = parts;

        this._applyTransform();
    }
    _getColorPalette() {
        const colors = ['#FF6347', '#3CB371', '#1E90FF', '#FFD700', '#BA55D3', '#FF8C00', '#00CED1', '#FF69B4'];
        return colors.map(c => `<span data-action="change-color" data-color="${c}" style="--color:${c}"></span>`).join('');
    }
    async _loadAvailableComponents() {
        const path = './components-list.json'; 
        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
            const list = await response.json();

            this._availableComponents = list;
        } catch (err) {
            console.warn(`Could not load component list from ${path}. Using fallback list.`, err);
            this._availableComponents = [];
        }

        this._updateContextMenuForComponents();
    }
    _initComponentSelectorModal() {
        const modal = document.createElement('div');
        modal.classList.add('ComponentSelectorModal');
        modal.innerHTML = `
            <div class="_overlay"></div>
            <div class="_modal-content">
                <h3>Aggiungi Componente</h3>
                <div class="_component-list"></div>
            </div>
        `;

        this._componentSelectorModal = modal;
        this.getContainer().appendChild(modal);

        modal.querySelector('._overlay').addEventListener('click', () => {
            modal.style.display = 'none';
            this._contextMenu.style.display = 'none'; 
        });

        modal.querySelector('._component-list').addEventListener('click', (e) => {
            const action = e.target.getAttribute('data-action');
            if (action === 'add-component-type') {
                this._handleContextMenuAction(action, e.target);
                modal.style.display = 'none'; 
            }
        });
    }

    _updateContextMenuForComponents() {
        const menu = this._contextMenu;
        if (!menu) return;

        let addComponentMenuItem = menu.querySelector('[data-action="add-component"]');

        if (!addComponentMenuItem) {
            addComponentMenuItem = document.createElement('div');
            addComponentMenuItem.classList.add('_action'); 
            addComponentMenuItem.setAttribute('data-action', 'add-component');
            addComponentMenuItem.textContent = 'Aggiungi Componente';
            menu.appendChild(addComponentMenuItem);
        }

        const modalList = this._componentSelectorModal ? this._componentSelectorModal.querySelector('._component-list') : null;
        if (modalList) {
            modalList.innerHTML = this._availableComponents.map(comp => 
                `<div class="_component-item" data-action="add-component-type" data-component-type="${comp.type}">${comp.name}</div>`
            ).join('');
        }
    }

    _initContextMenu() {
        const menu = document.createElement('div');
        menu.classList.add('ContextMenu');
        menu.style.position = 'absolute'; menu.style.display = 'none';
        menu.innerHTML = `
            <div class="_color-selector">${this._getColorPalette()}</div>
            <div class="_action" data-action="delete-wire">Elimina Filo</div>
            <div class="_action" data-action="delete-part">Elimina Parte</div>
            <div class="_action" data-action="delete-dot">Elimina Punto</div>
            <div class="_action" data-action="add-dot">Aggiungi Punto</div>
        `;
        this._contextMenu = menu;
        this.getContainer().appendChild(menu);

        document.addEventListener('click', (e) => { 
            if (!menu.contains(e.target)) {
                menu.style.display = 'none';
            }
        });

        menu.addEventListener('click', (e) => {
            const action = e.target.getAttribute('data-action');
            if (action) { 
                if (action === 'add-component') {

                    if (this._componentSelectorModal) {
                        this._componentSelectorModal.style.display = 'flex';
                    }

                } else {
                    this._handleContextMenuAction(action, e.target);
                }
            }
        });

        this._updateContextMenuForComponents();
    }

    _showContextMenu(e, type, key, index = -1) {
        e.preventDefault(); e.stopPropagation();
        const containerRect = this.getContainer().getBoundingClientRect();

        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        const diagCoords = this._getDiagramCoordinates(e);

        this._contextData = { type, key, index, x: diagCoords.x, y: diagCoords.y };

        const menu = this._contextMenu;
        const deleteWireItem = menu.querySelector('[data-action="delete-wire"]');
        const deletePartItem = menu.querySelector('[data-action="delete-part"]');
        const deleteDotItem = menu.querySelector('[data-action="delete-dot"]');
        const addDotItem = menu.querySelector('[data-action="add-dot"]');
        const colorSelector = menu.querySelector('._color-selector');

        const addComponentItem = menu.querySelector('[data-action="add-component"]'); 

        colorSelector.style.display = 'none';
        deleteWireItem.style.display = 'none';
        deletePartItem.style.display = 'none';
        deleteDotItem.style.display = 'none';
        addDotItem.style.display = 'none';
        if (addComponentItem) addComponentItem.style.display = 'none';

        if (this._componentSelectorModal) this._componentSelectorModal.style.display = 'none';

        if (type === 'wire') {
            colorSelector.style.display = 'flex';
            deleteWireItem.style.display = 'block';
            addDotItem.style.display = 'block';
        }
        else if (type === 'part') { deletePartItem.style.display = 'block'; }
        else if (type === 'dot') { deleteDotItem.style.display = 'block'; }
        else if (type === 'canvas' && addComponentItem) { 
             addComponentItem.style.display = 'block';
        }

        menu.style.left = `${mouseX + 5}px`;
        menu.style.top = `${mouseY + 5}px`;
        menu.style.display = 'flex';
    }

    _handleContextMenuAction(action, el) {
        const { type, key, index, x, y } = this._contextData;

        if (action !== 'add-component') {
            this._contextMenu.style.display = 'none';
        }

        if (action === 'delete-wire' && type === 'wire') {
            this.diagram.connections.splice(key, 1);
            this._selectedWireKey = -1;
            this.drawConnections(this.diagram.connections);
            this._updateSvgSize();
        }

        if (action === 'change-color' && (type === 'wire' || type === 'dot')) {
            const newColor = el.getAttribute('data-color');
            this.diagram.connections[key][2] = newColor;
            this.drawConnections(this.diagram.connections);
        }

        if (action === 'delete-part' && type === 'part') {
            this._deletePart(key);
        }

        if (action === 'delete-dot' && type === 'dot') {
            if (index >= 0 && key >= 0 && key < this.diagram.connections.length) {
                this.diagram.connections[key][3].splice(index, 1);
                this.drawConnections(this.diagram.connections);
                this._updateSvgSize();
            }
        }

        if (action === 'add-dot' && type === 'wire') {
            if (key >= 0 && key < this.diagram.connections.length) {
                const conn = this.diagram.connections[key];
                const metadata = conn[3] || [];
                const newDot = { x: Math.round(x), y: Math.round(y) };

                const points = [this._getPinPosition(conn[0]), ...metadata, this._getPinPosition(conn[1])];
                let minDistanceSq = Infinity;
                let insertIndex = metadata.length;

                for (let i = 0; i < points.length - 1; i++) {
                    const p1 = points[i];
                    const p2 = points[i+1];
                    const distSq = this._distanceToSegmentSq(x, y, p1.x, p1.y, p2.x, p2.y);
                    if (distSq < minDistanceSq) {
                        minDistanceSq = distSq;
                        insertIndex = i;
                    }
                }

                conn[3].splice(insertIndex, 0, newDot);
                this.drawConnections(this.diagram.connections);
                this._updateSvgSize();
            }
        }

        if (action === 'add-component-type' && type === 'canvas') {
            const componentType = el.getAttribute('data-component-type');
            if (componentType) {
                this.addComponent(componentType, x, y);
            }
        }

        if (action !== 'add-component') {
            this._contextData = {};
        }
    }

    _deletePart(partId) {
        const partIndex = this.diagram.parts.findIndex(p => p.id === partId);
        if (partIndex === -1) return;
        const partElement = this._getPartElement(partId);
        if (partElement) { partElement.remove(); delete this._partElementCache[partId]; Object.keys(this._pinElementCache).forEach(pid => { if (pid.startsWith(partId + ':')) delete this._pinElementCache[pid]; }); }
        this.diagram.parts.splice(partIndex, 1);
        this.diagram.connections = this.diagram.connections.filter(conn => {
            const s = conn[0].split(':')[0];
            const e = conn[1].split(':')[0];
            return s !== partId && e !== partId;
        });
        this.drawConnections(this.diagram.connections);
        this._updateSvgSize();
    }

    async addComponent(componentType, x, y) {
        const partId = 'part_' + Date.now();
        const newPart = {
            id: partId,
            type: componentType,
            left: Math.round(x),
            top: Math.round(y),
        };

        const path = `./res/components/${componentType}.json`;
        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
            const schema = await response.json();

            this.diagram.parts.push(newPart);
            this.drawPart(newPart, schema);
            this._updateSvgSize();

            const partElement = this._getPartElement(partId);
            if (partElement) {
                this._bringPartToFront(partElement);
            }

        } catch (err) {
            console.error(`Error loading component schema for ${componentType}:`, err);
            alert(`Impossibile caricare lo schema per il componente: ${componentType}. Verifica il file ${path}`);
        }
    }

    _bringPartToFront(partEl) {
        const children = Array.from(this.getPartsContainer().children);
        const maxZ = children.reduce((acc, el) => Math.max(acc, parseInt(el.style.zIndex || 0)), 0);
        partEl.style.zIndex = (maxZ + 1).toString();
    }

    _handlePartDragStart(e) {
        const part = e.target.closest('.Part'); if (!part) return;
        e.preventDefault(); e.stopPropagation();
        this._bringPartToFront(part);
        this.draggingPart = part; part.style.cursor = 'grabbing';
        const partRect = part.getBoundingClientRect();
        const contRect = this.getContainer().getBoundingClientRect();

        const diagCoords = this._getDiagramCoordinates(e);
        const currentLeft = parseFloat(part.style.left) || 0;
        const currentTop = parseFloat(part.style.top) || 0;

        this.dragPartOffsetX = diagCoords.x - currentLeft;
        this.dragPartOffsetY = diagCoords.y - currentTop;
    }
    _handlePartDrag(e) {
        if (!this.draggingPart) return; e.preventDefault(); e.stopPropagation();

        const diagCoords = this._getDiagramCoordinates(e);

        let newLeft = diagCoords.x - this.dragPartOffsetX;
        let newTop = diagCoords.y - this.dragPartOffsetY;

        newLeft = Math.max(0, Math.round(newLeft));
        newTop = Math.max(0, Math.round(newTop));

        this.draggingPart.style.left = `${newLeft}px`;
        this.draggingPart.style.top = `${newTop}px`;

        const pid = this.draggingPart.getAttribute('data-part-id');
        const p = this.diagram.parts.find(x => x.id === pid);
        if (p) { p.left = newLeft; p.top = newTop; }

        this.drawConnections(this.diagram.connections);
        this._updateSvgSize();
    }

    _handlePartDragEnd() { if (!this.draggingPart) return; this.draggingPart.style.cursor = 'grab'; this.draggingPart = null; this._updateSvgSize(); }

    _handleDotDragStart(e) {
        const dot = e.target.closest('.WireDot'); if (!dot) return;
        e.preventDefault(); e.stopPropagation();
        const connKey = parseInt(dot.getAttribute('data-conn-key'));
        this._selectWire(connKey);
        const dotIndex = parseInt(dot.getAttribute('data-dot-index'));
        if (isNaN(connKey) || isNaN(dotIndex) || connKey >= this.diagram.connections.length) return;

        this._bringWireToFront(connKey);
        this.draggingWireDot = { connKey, dotIndex };

        const diagCoords = this._getDiagramCoordinates(e);
        const currentPos = this.diagram.connections[connKey][3][dotIndex];

        this.dragDotOffsetX = diagCoords.x - currentPos.x;
        this.dragDotOffsetY = diagCoords.y - currentPos.y;

        dot.style.cursor = 'grabbing';
    }

    _handleDotDrag(e) {
        if (!this.draggingWireDot) return;
        e.preventDefault();
        e.stopPropagation();

        const { connKey, dotIndex } = this.draggingWireDot;
        const conn = this.diagram.connections[connKey];
        if (!conn || !conn[3] || !conn[3][dotIndex]) return;

        const diagCoords = this._getDiagramCoordinates(e);

        let newX = diagCoords.x - this.dragDotOffsetX;
        let newY = diagCoords.y - this.dragDotOffsetY;

        const [pin1Id, pin2Id] = conn;
        const refPoints = [this._getPinPosition(pin1Id), this._getPinPosition(pin2Id)];
        const otherDots = conn[3].filter((_, index) => index !== dotIndex);
        refPoints.push(...otherDots);

        let snappedX = newX;
        let snappedY = newY;

        refPoints.forEach(refP => {
            if (Math.abs(newX - refP.x) <= this.SNAP_THRESHOLD) {
                snappedX = refP.x;
            }
            if (Math.abs(newY - refP.y) <= this.SNAP_THRESHOLD) {
                snappedY = refP.y;
            }
        });

        newX = snappedX;
        newY = snappedY;

        newX = Math.max(0, Math.round(newX));
        newY = Math.max(0, Math.round(newY));

        conn[3][dotIndex].x = newX;
        conn[3][dotIndex].y = newY;

        this.drawConnections(this.diagram.connections);
        this._updateSvgSize();
    }

    _handleDotDragEnd() {
        if (!this.draggingWireDot) return;
        this.draggingWireDot = null;
        this._updateSvgSize();
    }

    _handlePanStart(e) {

        if (e.button !== 0 || e.target.closest('.Part') || e.target.closest('.Pin') || e.target.closest('.WireDot') || e.target.closest('.ContextMenu') || e.target.closest('.ComponentSelectorModal')) return;

        e.preventDefault();
        this.isPanning = true;
        this.getContainer().style.cursor = 'grabbing';
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
    }

    _handlePan(e) {
        if (!this.isPanning) return;
        e.preventDefault();

        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;

        this.translateX += dx;
        this.translateY += dy;

        this.panStartX = e.clientX;
        this.panStartY = e.clientY;

        this._applyTransform();
    }

    _handlePanEnd() {
        if (!this.isPanning) return;
        this.isPanning = false;
        this.getContainer().style.cursor = 'default';
    }

    _handleZoom(e) {
        e.preventDefault();

        if (this._componentSelectorModal && this._componentSelectorModal.style.display === 'flex') {
            return; 
        }

        const scaleFactor = 1.1;
        const delta = e.deltaY > 0 ? 1 / scaleFactor : scaleFactor;

        const newScale = Math.max(0.25, Math.min(4, this.scale * delta));
        if (newScale === this.scale) return;

        const containerRect = this.getContainer().getBoundingClientRect();

        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        const focalPointX = (mouseX - this.translateX) / this.scale;
        const focalPointY = (mouseY - this.translateY) / this.scale;

        this.scale = newScale;

        this.translateX = mouseX - focalPointX * this.scale;
        this.translateY = mouseY - focalPointY * this.scale;

        this._applyTransform();
        this.drawConnections(this.diagram.connections);
    }

    _setupDragListeners() {

        document.addEventListener('mousedown', (e) => {
            const dotClicked = e.target.closest('.WireDot');
            if (dotClicked) {
                this._handleDotDragStart(e);
                return;
            }

            const part = e.target.closest('.Part');
            if(part) {
                this._handlePartDragStart(e);
                return;
            }

            this._handlePanStart(e);
        });

        document.addEventListener('mousemove', (e) => { this._onGlobalMouseMove(e); });
        document.addEventListener('mouseup', (e) => { this._onGlobalMouseUp(e); });
    }

    _onGlobalMouseMove(e) {
        if (this.pendingWire.startPinId) { this._updatePendingWire(e); return; }
        if (this.draggingWireDot) { this._handleDotDrag(e); return; }
        if (this.draggingPart) { this._handlePartDrag(e); return; }

        if (this.isPanning) { this._handlePan(e); return; }

    }

    _onGlobalMouseUp(e) {
        if (this.pendingWire.startPinId) { this._connectPins(e); return; }
        if (this.draggingWireDot) { this._handleDotDragEnd(); return; }
        if (this.draggingPart) { this._handlePartDragEnd(); return; }

        if (this.isPanning) { this._handlePanEnd(); return; }

    }

    _setupCanvasListeners() {
        const container = this.getContainer();
        container.addEventListener('wheel', (e) => this._handleZoom(e), { passive: false });

    }

    _selectWire(connKey) {
        if (this._selectedWireKey !== connKey) {
            this._selectedWireKey = connKey;
            this.drawConnections(this.diagram.connections);
        }
    }

    _clearSelection() {
        if (this._selectedWireKey !== -1) {
            this._selectedWireKey = -1;
            this.drawConnections(this.diagram.connections);
        }
    }

    _setupWireListeners() {
        this.getContainer().addEventListener('contextmenu', (e) => {

            const diagCoords = this._getDiagramCoordinates(e);

            const dot = e.target.closest('.WireDot');
            if (dot) {
                const connKey = parseInt(dot.getAttribute('data-conn-key'));
                const dotIndex = parseInt(dot.getAttribute('data-dot-index'));
                if (!isNaN(connKey) && !isNaN(dotIndex)) {
                    this._selectWire(connKey);
                    this._showContextMenu(e, 'dot', connKey, dotIndex); return;
                }
            }

            const closestWireKey = this._findWireAtCoordinates(diagCoords.x, diagCoords.y);
            if (closestWireKey !== -1) {
                if (!e.target.closest('.Pin')) {
                    this._selectWire(closestWireKey);
                    this._bringWireToFront(closestWireKey);
                    this._showContextMenu(e, 'wire', closestWireKey);
                    return;
                }
            }

            const part = e.target.closest('.Part');
            if (part) {
                this._clearSelection();
                const partId = part.getAttribute('data-part-id');
                if (partId) { this._showContextMenu(e, 'part', partId); return; }
            }

            if (!e.target.closest('.Part') && !e.target.closest('.Pin') && closestWireKey === -1) {
                this._clearSelection();
                this._showContextMenu(e, 'canvas', -1); 
                return;
            }

            this._clearSelection();
        });

        this.getContainer().addEventListener('mousedown', (e) => {

            if (this.isPanning) return;

            const pin = e.target.closest('.Pin');
            if (pin && !this.draggingPart && !this.draggingWireDot) {
                e.preventDefault(); e.stopPropagation();
                this._clearSelection();
                this._startNewWire(pin);
                return;
            }

            if (!this.draggingPart && !this.draggingWireDot) {
                const diagCoords = this._getDiagramCoordinates(e);
                const closestWireKey = this._findWireAtCoordinates(diagCoords.x, diagCoords.y);

                if (closestWireKey !== -1 && !e.target.closest('.Pin')) {
                    this._selectWire(closestWireKey);
                    this._bringWireToFront(closestWireKey);
                    return;
                }

                if (!e.target.closest('.Part') && !e.target.closest('.Pin') && closestWireKey === -1) {
                    this._clearSelection();
                }
            }

            const part = e.target.closest('.Part'); if (part) { this._bringPartToFront(part); }
        });
    }
    _startNewWire(pinElement) {
        const part = pinElement.closest('.Part'); if (!part) return;
        const partId = part.getAttribute('data-part-id'); const pinId = pinElement.getAttribute('pin-id');
        const fullPinId = `${partId}:${pinId}`;
        const startPos = this._getPinPosition(fullPinId);

        this.pendingWire.startPinId = fullPinId;
        this.pendingWire.startX = startPos.x;
        this.pendingWire.startY = startPos.y;

        const tempSvg = this._ns('svg'); tempSvg.style.position = 'absolute';

        tempSvg.style.left = `${startPos.x * this.scale + this.translateX - 8}px`;
        tempSvg.style.top = `${startPos.y * this.scale + this.translateY - 8}px`;

        tempSvg.style.pointerEvents = 'none'; tempSvg.setAttribute('data-temp', '1');
        const tempLine = this._ns('line'); tempLine.setAttribute('x1', 8); tempLine.setAttribute('y1', 8); tempLine.setAttribute('x2', 8); tempLine.setAttribute('y2', 8); tempLine.setAttribute('stroke', 'blue'); tempLine.setAttribute('stroke-width', 3); tempLine.setAttribute('stroke-dasharray', '5,5'); tempLine.setAttribute('pointer-events', 'none');
        tempSvg.appendChild(tempLine); this.getContainer().appendChild(tempSvg);
        this.pendingWire.tempSvg = tempSvg; this.pendingWire.tempLine = tempLine;

    }
    _updatePendingWire(e) {
        if (!this.pendingWire.startPinId) return;
        const containerRect = this.getContainer().getBoundingClientRect();
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        const tempSvg = this.pendingWire.tempSvg;
        const tempLine = this.pendingWire.tempLine;
        if (!tempSvg || !tempLine) return;

        const start = {
            x: this.pendingWire.startX * this.scale + this.translateX,
            y: this.pendingWire.startY * this.scale + this.translateY
        };

        const minX = Math.min(start.x, mouseX);
        const minY = Math.min(start.y, mouseY);
        const maxX = Math.max(start.x, mouseX);
        const maxY = Math.max(start.y, mouseY);
        const pad = 8;

        const left = minX - pad;
        const top = minY - pad;
        const width = (maxX - minX) + pad * 2;
        const height = (maxY - minY) + pad * 2;

        tempSvg.style.left = `${left}px`;
        tempSvg.style.top = `${top}px`;
        tempSvg.setAttribute('width', width);
        tempSvg.setAttribute('height', height);
        tempSvg.style.width = `${width}px`;
        tempSvg.style.height = `${height}px`;

        const relStartX = start.x - left;
        const relStartY = start.y - top;
        const relMouseX = mouseX - left;
        const relMouseY = mouseY - top;

        tempLine.setAttribute('x1', relStartX);
        tempLine.setAttribute('y1', relStartY);
        tempLine.setAttribute('x2', relMouseX);
        tempLine.setAttribute('y2', relMouseY);
    }
    _connectPins(e) {
        if (!this.pendingWire.startPinId) return;
        const endPin = e.target.closest('.Pin');
        const startPinId = this.pendingWire.startPinId;

        if (this.pendingWire.tempSvg) { this.pendingWire.tempSvg.remove(); this.pendingWire.tempSvg = null; this.pendingWire.tempLine = null; }

        if (endPin) {
            const endPart = endPin.closest('.Part'); const endPartId = endPart.getAttribute('data-part-id');
            const endPinId = endPin.getAttribute('pin-id'); const fullEndPinId = `${endPartId}:${endPinId}`;
            if (startPinId !== fullEndPinId) {
                const newConnection = [startPinId, fullEndPinId, 'blue', []];
                this.diagram.connections.push(newConnection);
                this.drawConnections(this.diagram.connections);
                this._updateSvgSize();
            }
        }
        this.pendingWire = { startPinId: null, tempSvg: null, tempLine: null, startX: 0, startY: 0 };
    }

    _updateSvgSize() {
        let maxWidth = 0; let maxHeight = 0; const padding = 64;

        this.diagram.parts.forEach(part => {
            const el = this._getPartElement(part.id); if (!el) return;
            const w = el.offsetWidth || 0; const h = el.offsetHeight || 0;

            maxWidth = Math.max(maxWidth, part.left + w);
            maxHeight = Math.max(maxHeight, part.top + h);

            el.querySelectorAll('.Pin').forEach(pinEl => {

                const pinRect = pinEl.getBoundingClientRect();
                const partRect = el.getBoundingClientRect();

                const pinX = part.left + (pinRect.left - partRect.left) + pinRect.width / 2;
                const pinY = part.top + (pinRect.top - partRect.top) + pinRect.height / 2;

                maxWidth = Math.max(maxWidth, pinX + 8);
                maxHeight = Math.max(maxHeight, pinY + 8);
            });
        });

        this.diagram.connections.forEach(conn => {
            const meta = conn[3] || [];
            meta.forEach(p => { if (p && typeof p.x === 'number' && typeof p.y === 'number') { maxWidth = Math.max(maxWidth, p.x + 8); maxHeight = Math.max(maxHeight, p.y + 8); } });

            const p1 = this._getPinPosition(conn[0]);
            const p2 = this._getPinPosition(conn[1]);

            maxWidth = Math.max(maxWidth, p1.x + 8, p2.x + 8);
            maxHeight = Math.max(maxHeight, p1.y + 8, p2.y + 8);
        });

        const finalW = maxWidth + padding;
        const finalH = maxHeight + padding;

        this.svgCanvas.style.width = `${finalW}px`;
        this.svgCanvas.style.height = `${finalH}px`;
        this.partsContainer.style.width = `${finalW}px`;
        this.partsContainer.style.height = `${finalH}px`;
    }

    drawConnections(connections) {
        this.getWireContainer().querySelectorAll('svg[data-conn-key]').forEach(s => s.remove());

        const sortedConnections = connections
            .map((c, i) => ({ conn: c, index: i }))
            .sort((a, b) => (a.index === this._selectedWireKey ? 1 : b.index === this._selectedWireKey ? -1 : 0));

        sortedConnections.forEach(item => this.drawWire(item.conn, item.index));
    }

    drawWire(wire_config, connKey) {
        const [pin1Id, pin2Id, colorRaw, metadataRaw] = wire_config;
        const color = colorRaw || 'black';
        const metadata = Array.isArray(metadataRaw) ? metadataRaw : [];

        const P1 = this._getPinPosition(pin1Id);
        const P2 = this._getPinPosition(pin2Id);

        const isSelected = this._selectedWireKey === connKey;

        const dotRadius = 5;
        const pad = dotRadius * 2 + 6;

        let minX = Math.min(P1.x, P2.x); let minY = Math.min(P1.y, P2.y);
        let maxX = Math.max(P1.x, P2.x); let maxY = Math.max(P1.y, P2.y);
        metadata.forEach((pt) => {
            if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
                minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
                maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
            }
        });

        minX -= pad; minY -= pad; maxX += pad; maxY += pad;
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);

        const ns = 'http://www.w3.org/2000/svg';
        const el_svg = document.createElementNS(ns, 'svg');
        el_svg.setAttribute('width', width); el_svg.setAttribute('height', height);
        el_svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        el_svg.style.position = 'absolute';

        el_svg.style.left = `${minX}px`;
        el_svg.style.top = `${minY}px`;

        el_svg.style.width = `${width}px`; el_svg.style.height = `${height}px`;
        el_svg.style.pointerEvents = 'none';
        el_svg.style.zIndex = isSelected ? '10' : '5';
        el_svg.classList.add('WireSvg');
        el_svg.setAttribute('data-conn-key', connKey);

        const shiftX = -minX; const shiftY = -minY;
        let d = `M ${P1.x + shiftX} ${P1.y + shiftY}`;
        metadata.forEach(pt => { if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') d += ` L ${pt.x + shiftX} ${pt.y + shiftY}`; });
        d += ` L ${P2.x + shiftX} ${P2.y + shiftY}`;

        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', isSelected ? 8 : 6);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');

        if (isSelected) {
            path.style.filter = `drop-shadow(0 0 5px ${color})`;
            path.classList.add('wire-path-selected');
        }

        path.classList.add('wire-path'); path.setAttribute('data-conn-key', connKey);
        path.style.pointerEvents = 'none';
        path.style.cursor = 'default';
        el_svg.appendChild(path);

        metadata.forEach((pt, index) => {
            if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
                const dot = document.createElementNS(ns, 'circle');
                dot.setAttribute('cx', pt.x + shiftX);
                dot.setAttribute('cy', pt.y + shiftY);
                dot.setAttribute('r', isSelected ? dotRadius + 2 : dotRadius);
                dot.setAttribute('fill', 'white');
                dot.setAttribute('stroke', color);
                dot.setAttribute('stroke-width', 2);
                dot.classList.add('WireDot');
                dot.setAttribute('data-conn-key', connKey);
                dot.setAttribute('data-dot-index', index);
                dot.style.cursor = 'grab';
                dot.style.pointerEvents = 'all';

                el_svg.appendChild(dot);
            }
        });

        this.getWireContainer().appendChild(el_svg);
    }

    _bringWireToFront(connKey) {
        if (connKey < 0 || connKey >= this.diagram.connections.length) return;
        const w = this.diagram.connections.splice(connKey, 1)[0];
        this.diagram.connections.push(w);
        this.drawConnections(this.diagram.connections);
        this._updateSvgSize();
    }

    async loadDiagram(diagram) {
        if (!('parts' in diagram) || !('connections' in diagram)) return;
        this.diagram = JSON.parse(JSON.stringify(diagram));
        this.getPartsContainer().querySelectorAll('.Part').forEach(el => el.remove());
        this.getWireContainer().querySelectorAll('svg[data-conn-key]').forEach(s => s.remove());
        this._partElementCache = {};
        this._pinElementCache = {};
        const loadPromises = diagram.parts.map(async part => {
            const path = `./res/components/${part.type}.json`;
            try {
                const response = await fetch(path);
                if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
                const schema = await response.json();
                this.drawPart(part, schema);
            } catch (err) { }
        });
        await Promise.all(loadPromises);
        this._updateSvgSize();
        requestAnimationFrame(() => { this.drawConnections(this.diagram.connections); requestAnimationFrame(() => this._updateSvgSize()); });
    }

    drawPart(partConfig, schema) {
        if (!('pins' in schema)) return;
        const el = document.createElement('div'); this.getPartsContainer().appendChild(el);
        el.classList.add('Part'); el.setAttribute('data-part-id', partConfig.id);

        el.style.left = `${partConfig.left}px`; el.style.top = `${partConfig.top}px`;
        el.style.cursor = 'grab'; this._partElementCache[partConfig.id] = el;
        if ('size' in schema && typeof schema.size === 'object' && schema.size) { el.style.width = schema.size[0]; el.style.height = schema.size[1]; }
        if ('preview' in schema && schema.preview) { const img = document.createElement('img'); img.src = './res/images/' + schema.preview; el.appendChild(img); }
        else{
            el.classList.add("base-shield");
            const name = document.createElement("span");
            name.classList.add("_name");
            name.textContent = schema.name;
            el.appendChild(name);
        }

        schema.pins.forEach((pin, k) => {
            const pinName = pin[0];
            let posX = pin[1] !== undefined ? pin[1] : 0;
            let posY = pin[2] !== undefined ? pin[2] : 0;
            const el_pin = document.createElement('div'); el_pin.classList.add('Pin'); el_pin.setAttribute('pin-id', pinName);
            el_pin.style.left = `${posX}px`; el_pin.style.top = `${posY}px`;
            if (pin[3] !== undefined) { const lbl = document.createElement('span'); lbl.textContent = pin[3]; el_pin.appendChild(lbl); }

            el.appendChild(el_pin);
            this._pinElementCache[`${partConfig.id}:${pinName}`] = el_pin;
        });
    }

    exportDiagram() { return JSON.parse(JSON.stringify(this.diagram)); }
    downloadDiagram(filename='diagram.json'){ const diagramData = this.exportDiagram(); const jsonString = JSON.stringify(diagramData,null,2); const blob = new Blob([jsonString], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }
}