import { fixMouseCoord, getAbsolutePosition } from "./utils.js";
import { Menu } from "./Menu.js";

export const ConnectionType = ["wire", "i2c", "can", "rs485"];

const SVG_NS = 'http://www.w3.org/2000/svg';

const CONSTANTS = {
    DOT_RADIUS: 6,
    STROKE_WIDTH: 4,
    BOUNDING_BOX_PADDING: 16, 
    SNAP_THRESHOLD: 16, 
    TEMP_CONNECTION_STROKE: 6,
    DEFAULT_LABEL: "Commento",
    CURVE_TENSION: 0.5
};

const MENU_ACTIONS_CONFIG = [
    { id: "comment", icon: "./res/Editor/icons/comment.svg", action: (menu) => menu.data.config.label = CONSTANTS.DEFAULT_LABEL },
    { id: "addDot", icon: "./res/Editor/icons/add.svg", action: (menu) => menu.data.addDot() },
    { id: "removeDot", icon: "./res/Editor/icons/remove.svg", action: (menu) => menu.data.removeDot() },
    { id: "removeConnection", icon: "./res/Editor/icons/delete.svg", action: (menu) => {
        menu.data.remove();
        menu.close();
        menu.data._dispatchDeleteEvent();
    }}
];

const createHTMLElement = (tag, classes = []) => {
    const element = document.createElement(tag);
    element.classList.add(...classes);
    return element;
};

const createSVGElement = (tag, attributes = {}) => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
};

class ConnectionMenu extends Menu {
    draw(container) {
        if (this.element?.parentElement === container) {
            this._updateColorListState();
            return;
        }

        this.element?.remove();
        this.items.clear();
        this.element = createHTMLElement("div", ["Menu", "MenuConnection"]);
        container.appendChild(this.element);
        this._renderColorList();
        this._renderActions();
    }

    _updateColorListState() {
        if (!this.element) return;
        const activeColor = this.data.config.color;
        this.element.querySelector('.list .active')?.classList.remove('active');
        this.element.querySelector(`[data-color="${activeColor}"]`)?.classList.add('active');
    }

    _renderColorList() {
        const listContainer = createHTMLElement("div", ["list", "color-list"]);
        this.data.editor.colorList.forEach(color => listContainer.appendChild(this._createColorSpan(color)));
        this.element.appendChild(listContainer);
    }

    _renderActions() {
        const listContainer = createHTMLElement("div", ["list", "action-list"]);
        MENU_ACTIONS_CONFIG.forEach(action => listContainer.appendChild(this._createActionItem(action)));
        this.element.appendChild(listContainer);
    }

    _createColorSpan(color) {
        const span = createHTMLElement("span");
        span.dataset.color = color;
        span.style.setProperty("--color", color);
        if (color === this.data.config.color) span.classList.add("active");

        span.addEventListener("click", () => {
            this.data.setColor(color);
            this._updateColorListState();
        });
        return span;
    }

    _createActionItem(item) {
        const span = createHTMLElement("span", ["action-item"]);
        const img = createHTMLElement("img");
        if (item.id) this.items.set(item.id, span);

        img.src = item.icon;
        span.appendChild(img);

        span.addEventListener("click", (e) => {
            item.action(this);
            this.close();
        });
        return span;
    }

    open(posX, posY) {
        this.element.position = { x: posX, y: posY };
        this._updateRemoveDotVisibility(posX, posY);
        super.open(posX, posY);
    }

    _updateRemoveDotVisibility(posX, posY) {
        const removeDotButton = this.items.get("removeDot");
        if (removeDotButton) {
            const nearDot = this.data.getNearestDotIndex(posX, posY);
            removeDotButton.style.display = nearDot !== null ? "flex" : "none";
        }
    }

    remove() {
        this.element?.remove();
        this.element = null;
        this.items.clear();
    }
}

export class Connection {
    constructor(config, editor) {
        this.config = config;
        this.editor = editor;
        this.menu = new ConnectionMenu(this);
        this.el_svg = null;
        this.el_paths = [];
        this.dots = [];
        this.currentDraggedDot = null;

        this._bindHandlers();
        this._attachGlobalListeners();
    }

    _bindHandlers() {
        this.updateHandler = this._handleUpdate.bind(this);
        this.moveHandler = this._handleDotDragMove.bind(this);
        this.endHandler = this._handleDotDragEnd.bind(this);
        this.componentUpdateHandler = this._onComponentUpdate.bind(this);
        this.componentDeleteHandler = this._onComponentDelete.bind(this);
    }

    _attachGlobalListeners() {
        document.addEventListener("connection_update", this.updateHandler);
        document.addEventListener("component_update", this.componentUpdateHandler);
        document.addEventListener("component_delete", this.componentDeleteHandler);
    }

    _detachGlobalListeners() {
        document.removeEventListener("connection_update", this.updateHandler);
        document.removeEventListener("component_update", this.componentUpdateHandler);
        document.removeEventListener("component_delete", this.componentDeleteHandler);
    }

    _getReference(pinRef, type = 'pin'){
        const [componentId, pinId] = pinRef.split(":");
        const component = this.editor.components.get(componentId);
        return type === 'pin' ? component?.pins.get(pinId) : component;
    }

    get pinFrom() { return this._getReference(this.config.from, 'pin'); }
    get componentFrom() { return this._getReference(this.config.from, 'component'); }
    get pinTo() { return this._getReference(this.config.to, 'pin'); }
    get componentTo() { return this._getReference(this.config.to, 'component'); }

    _onComponentUpdate(event) {
        const componentId = event.detail.componentID;
        if ([this.componentFrom?.config.id, this.componentTo?.config.id].includes(componentId)){this.draw();};
    }

    _onComponentDelete(event) {
        const componentId = event.detail.componentID;
        if ([this.componentFrom?.config.id, this.componentTo?.config.id].includes(componentId)) this.remove();
    }

    draw() {
        if (!this.pinFrom || !this.pinTo) return this.remove();

        this._ensureSVGContainer();
        const { pin1, pin2, shiftX, shiftY } = this._calculateBoundingBox();

        this._renderPaths(pin1, pin2, shiftX, shiftY);
        this._renderDots(shiftX, shiftY);
        this.menu.draw(this.editor.container);
    }

    _ensureSVGContainer() {
        if (this.el_svg?.parentElement === this.editor.connectionsContainer) return;

        this.el_svg?.remove();
        this.el_svg = createSVGElement('svg', { 'class': "Connection", 'data-conn-id': this.config.id });
        this.editor.connectionsContainer.appendChild(this.el_svg);
    }

    _renderPaths(pin1, pin2, shiftX, shiftY) {
        const pathCoords = [pin1, ...(this.config.constrains || []), pin2].filter(p => p?.x !== undefined && p?.y !== undefined);
        const requiredPaths = pathCoords.length - 1;

        while (this.el_paths.length > requiredPaths) this.el_paths.pop().remove();

        for (let i = 0; i < requiredPaths; i++) {
            let path = this.el_paths[i];
            if (!path) {
                path = this._createPathSegment(i);
                this.el_paths.push(path);
                this.el_svg.appendChild(path);
            }
            this._updatePathSegment(path, pathCoords[i], pathCoords[i + 1], shiftX, shiftY, i);
        }
    }

    _createPathSegment(index) {
        const line = createSVGElement('line', {
            'stroke-width': CONSTANTS.STROKE_WIDTH, 'stroke-linecap': 'round',
            'stroke-linejoin': 'round', 'data-segment-index': index
        });
        line.classList.add("Connection-Path");
        return line;
    }

    _updatePathSegment(line, startPoint, endPoint, shiftX, shiftY) {
        const p1 = { x: startPoint.x + shiftX, y: startPoint.y + shiftY };
        const p2 = { x: endPoint.x + shiftX, y: endPoint.y + shiftY };

        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const length = Math.hypot(dx, dy);
        const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

        line.setAttribute('style', `--color:${this.config.color}`);
        line.setAttribute('x1', 0); line.setAttribute('y1', 0);
        line.setAttribute('x2', length); line.setAttribute('y2', 0);
        line.setAttribute('transform', `translate(${p1.x}, ${p1.y}) rotate(${angleDeg})`);
        line.setAttribute('stroke', this.config.color);
    }

    _renderDots(shiftX, shiftY) {
        const constrains = this.config.constrains || [];
        const requiredDots = constrains.length;

        while (this.dots.length > requiredDots) this.dots.pop().remove();

        constrains.forEach((point, index) => {
            if (point?.x !== undefined) {
                let dot = this.dots[index];
                if (!dot) {
                    dot = this._createDotElement(index);
                    this.dots.push(dot);
                    this.el_svg.appendChild(dot);
                }
                dot.setAttribute('cx', point.x + shiftX);
                dot.setAttribute('cy', point.y + shiftY);
                dot.setAttribute('stroke', this.config.color);
            }
        });
    }

    _createDotElement(index) {
        const dot = createSVGElement('circle', {
            'class': "Dot", 'r': CONSTANTS.DOT_RADIUS, 'fill': 'white',
            'stroke-width': CONSTANTS.STROKE_WIDTH, 'data-conn-dot-id': index
        });
        dot.addEventListener('mousedown', (e) => this._handleDotDragStart(e, index));
        return dot;
    }

    _calculateBoundingBox() {
        const points = [this.pinFrom.position, this.pinTo.position, ...(this.config.constrains || [])].filter(p => p?.x !== undefined);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(point => {
            minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
        });

        const padding = CONSTANTS.BOUNDING_BOX_PADDING;
        minX -= padding; minY -= padding; maxX += padding; maxY += padding;

        const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
        const shiftX = -minX, shiftY = -minY;

        if (this.el_svg) {
            Object.assign(this.el_svg.style, { left: `${minX}px`, top: `${minY}px`, width: `${width}px`, height: `${height}px` });
            this.el_svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }
        return { pin1: this.pinFrom.position, pin2: this.pinTo.position, shiftX, shiftY };
    }

    _dispatchUpdateEvent(){
        document.dispatchEvent(new CustomEvent("emit_connection_update", {detail: {
            connectionID: this.config.id,
            config: this.config
        }}))
    }

    addDot() {
        const position = this.menu.position;
        if (!position?.x || !position?.y) return;

        const allPoints = [this.pinFrom.position, ...(this.config.constrains || []), this.pinTo.position].filter(p => p?.x !== undefined);
        if (allPoints.length < 2) return;

        const insertionIndex = this._findNearestSegment(position, allPoints);
        if (insertionIndex !== -1) {
            if (!this.config.constrains) this.config.constrains = [];

            const newPoint = { x: position.x, y: position.y };
            this.config.constrains.splice(insertionIndex, 0, newPoint);

            this.draw();
            this._dispatchUpdateEvent();
        }
    }

    removeDot() {
        const nearDotIndex = this.getNearestDotIndex(this.menu.position.x, this.menu.position.y);
        if (nearDotIndex !== null) {
            this.config.constrains.splice(nearDotIndex, 1);
            this.draw();
            this._dispatchUpdateEvent();
        }
    }

    getNearestDotIndex(posX, posY) {
        const constrains = this.config.constrains || [];
        const MIN_DISTANCE_SQ = CONSTANTS.SNAP_THRESHOLD * CONSTANTS.SNAP_THRESHOLD;
        let minDistanceSq = Infinity, indexToRemove = -1;

        constrains.forEach((dot, index) => {
            if (dot && dot.x !== undefined) {
                const distanceSq = this._getDistanceSq(posX, posY, dot.x, dot.y);
                if (distanceSq < minDistanceSq) {
                    minDistanceSq = distanceSq;
                    indexToRemove = index;
                }
            }
        });
        return (indexToRemove !== -1 && minDistanceSq <= MIN_DISTANCE_SQ) ? indexToRemove : null;
    }

    _findNearestSegment(position, allPoints) {
        let minDistanceSq = Infinity, insertionIndex = -1;
        for (let i = 0; i < allPoints.length - 1; i++) {
            const segmentDistanceSq = this._distanceToSegmentSq(position, allPoints[i], allPoints[i + 1]);
            if (segmentDistanceSq < minDistanceSq) {
                minDistanceSq = segmentDistanceSq;
                insertionIndex = i;
            }
        }
        return insertionIndex;
    }

    _getDistanceSq(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; }

    _distanceToSegmentSq(point, segmentStart, segmentEnd) {
        const dx = segmentEnd.x - segmentStart.x, dy = segmentEnd.y - segmentStart.y;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) return this._getDistanceSq(point.x, point.y, segmentStart.x, segmentStart.y);

        let t = ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        const closestX = segmentStart.x + t * dx;
        const closestY = segmentStart.y + t * dy;

        return this._getDistanceSq(point.x, point.y, closestX, closestY);
    }

    _handleUpdate(e){
        if(e.detail.connectionID === this.config.id){ this.config = e.detail.config; this.draw()}
    }

    _handleDotDragStart(event, index) {
        event.stopPropagation();
        this.setSelected(true, event);
        const constrain = this.config.constrains[index];
        fixMouseCoord(event, this.editor.scale, this.editor.view);

        this.currentDraggedDot = {
            index,
            startCoord: { x: event.mouseX, y: event.mouseY, dotX: constrain.x, dotY: constrain.y }
        };

        this.editor.container.addEventListener('mousemove', this.moveHandler);
        this.editor.container.addEventListener('mouseup', this.endHandler);
    }

    _handleDotDragMove(event) {
        if (!this.currentDraggedDot) return;
        event.stopPropagation();
        fixMouseCoord(event, this.editor.scale, this.editor.view);

        const { index, startCoord } = this.currentDraggedDot;
        const { x: startX, y: startY, dotX, dotY } = startCoord;

        let newX = dotX + (event.mouseX - startX);
        let newY = dotY + (event.mouseY - startY);

        const snappedCoords = this._applySnapping(newX, newY, index);

        this.config.constrains[index].x = Math.round(snappedCoords.x);
        this.config.constrains[index].y = Math.round(snappedCoords.y);

        this.draw();
        this.setSelected(true, event);
    }

    _applySnapping(x, y, excludeIndex) {
        const referencePoints = [
            this.pinFrom.position, this.pinTo.position,
            ...(this.config.constrains || []).filter((_, i) => i !== excludeIndex)
        ];

        let [snappedX, snappedY] = [x, y];
        const threshold = CONSTANTS.SNAP_THRESHOLD;

        referencePoints.forEach(refPoint => {
            if (Math.abs(x - refPoint.x) <= threshold) snappedX = refPoint.x;
            if (Math.abs(y - refPoint.y) <= threshold) snappedY = refPoint.y;
        });
        return { x: snappedX, y: snappedY };
    }

    _handleDotDragEnd() {
        if (!this.currentDraggedDot) return;
        this.editor.container.removeEventListener('mousemove', this.moveHandler);
        this.editor.container.removeEventListener('mouseup', this.endHandler);
        this.currentDraggedDot = null;
        this._dispatchUpdateEvent();
    }

    setSelected(selected, event) {
        if (!this.el_svg) return;
        this.el_svg.classList.toggle("selected", selected);
        this.el_paths.forEach(path => path.classList.toggle("selected", selected));

        if (selected && event?.openMenu) this.menu.open(event.mouseX, event.mouseY);
        else this.menu.close();
    }

    setColor(color) {
        this.config.color = color;
        this.el_paths.forEach(path => {
            path?.setAttribute('stroke', color);
            path?.setAttribute('style', `--color:${color}`);
        });
        this.dots.forEach(dot => dot.setAttribute('stroke', color));
        this.menu._updateColorListState();
        this._dispatchUpdateEvent();
    }

    getConnectionSchema() {
        const { from, to, type, color, constrains, label } = this.config;
        return [from, to, type, color, (constrains || []).map(c => [c.x, c.y]), label];
    }

    remove(){
        if (this.currentDraggedDot) this._handleDotDragEnd();
        this._detachGlobalListeners();
        this.menu.remove(); this.el_svg?.remove();
        this.el_svg = null; this.el_paths = []; this.dots = [];
    }

    _dispatchDeleteEvent() {
        document.dispatchEvent(new CustomEvent("emit_connection_delete", {
            detail: { connectionID: this.config.id }
        }));
    }
}

export class TempConnection {
    constructor(config, svgContainer) {
        this.config = config;
        this.svgContainer = svgContainer;
        this.el_svg = this.el_path = null;
        this.startX = this.config.from.position.x;
        this.startY = this.config.from.position.y;
        this.endX = this.endY = this.startX;
        this._createPathElement();
    }

    _createPathElement() {
        this.el_svg = createSVGElement('svg', { 'class': "Connection temp", 'data-conn-id': this.config.id });
        this.svgContainer.appendChild(this.el_svg);

        this.el_path = createSVGElement('path', {
            'style': `--color:${this.config.color}`, 'stroke': this.config.color,
            'stroke-width': CONSTANTS.TEMP_CONNECTION_STROKE, 'fill': 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        });

        this.el_svg.appendChild(this.el_path);
        this.update(this.startX, this.startY);
    }

    update(clientX, clientY) {
        if (!this.el_path) return;
        this.endX = clientX; this.endY = clientY;

        const pin1 = { x: this.startX, y: this.startY }, pin2 = { x: this.endX, y: this.endY };
        const { shiftX, shiftY, minX, minY, width, height } = this._calculateBoundingBox(pin1, pin2);

        Object.assign(this.el_svg.style, { left: `${minX}px`, top: `${minY}px`, width: `${width}px`, height: `${height}px` });
        this.el_svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        this.el_path.setAttribute('d', this._generateCurvePath(pin1, pin2, shiftX, shiftY));
    }

    _calculateBoundingBox(pin1, pin2) {
        const points = [pin1, pin2];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(pt => {
            minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
        });

        const padding = CONSTANTS.BOUNDING_BOX_PADDING;
        minX -= padding; minY -= padding; maxX += padding; maxY += padding;

        const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
        const shiftX = -minX, shiftY = -minY;

        return { shiftX, shiftY, minX, minY, width, height };
    }

    _generateCurvePath(pin1, pin2, shiftX, shiftY) {
        const p1x = pin1.x + shiftX, p1y = pin1.y + shiftY;
        const p2x = pin2.x + shiftX, p2y = pin2.y + shiftY;

        const tension = CONSTANTS.CURVE_TENSION;
        const dx = (p2x - p1x) * tension;

        const controlX1 = p1x + dx;
        const controlY1 = p1y;
        const controlX2 = p2x - dx;
        const controlY2 = p2y;

        return `M${p1x},${p1y} C${controlX1},${controlY1} ${controlX2},${controlY2} ${p2x},${p2y}`;
    }

    remove() {
        this.el_svg?.remove();
        this.el_svg = this.el_path = null;
    }
}