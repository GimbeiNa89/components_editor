import { getAbsolutePosition, getJsonFileFromPath, fixMouseCoord} from "./utils.js";
import { Pin } from "./Pin.js";
import { Menu } from "./Menu.js";

class ComponentMenu extends Menu {
    constructor(data) { super(data); }

    draw(container) {
        const menuItems = this._buildMenuItems();
        super.draw(menuItems, container);
    }

    _buildMenuItems() {
        const items = [];

        if (this.data.schema.script) {
            items.push({ 
                icon: "./res/Editor/icons/settings.svg", 
                label: "Configura", 
                action: () => { /* TODO: implement configuration */ }
            });
        }

        items.push(
            {
                icon: "./res/Editor/icons/rotate_orario.svg", 
                label: "Ruota di 90°", 
                action: () => this.data.rotate(90)
            },
            {
                icon: "./res/Editor/icons/rotate_antiorario.svg", 
                label: "Ruota di -90°", 
                action: () => this.data.rotate(-90)
            },
            {
                icon: "./res/Editor/icons/delete.svg", 
                label: "Elimina", 
                color: "red", 
                action: () => {
                    this.data.remove();
                    this.close();
                }
            }
        );

        return items;
    }
}

export class Component {
    constructor(config, editor) {
        this.config = config; 
        this.editor = editor;
        this.schema = getJsonFileFromPath(this.editor.components_path+"/"+config.type+".json");

        this.menu = new ComponentMenu(this);
        this.element = null;
        this.pins = new Map(); 
        this.draggingCoord = null;

        this._initializeConfig();
        this._initializeSize();
        this._bindEventHandlers();
    }

    // === INITIALIZATION ===
    
    _initializeConfig() {
        this.config.rotation = this.config.rotation || 0;
    }

    _initializeSize() {
        [this.width, this.height] = this.schema.size 
            ? this.schema.size.map(s => parseFloat(s)) 
            : [0, 0];
    }

    _bindEventHandlers() {
        this._handleUpdateBound = this._handleUpdate.bind(this);
        this._handleDragStartBound = this._handleDragStart.bind(this);
        this._handleDragMoveBound = this._handleDragMove.bind(this);
        this._handleDragEndBound = this._handleDragEnd.bind(this);
    }

    // === RENDERING ===

    draw() {
        this._cleanup();
        this._createElement();
        this._applyStyles();
        this._renderContent();
        this._renderPins();
        this._attachToDOM();
        this.addEventListeners();
        this.menu.draw(this.editor.container);
    }

    _cleanup() {
        if (this.element) {
            this.removeEventListeners(); 
            this.element.remove();
            this.pins.clear(); 
        }
    }

    _createElement() {
        this.element = document.createElement('div');
        this.element.classList.add('Component');
        this.element.setAttribute('data-component-id', this.config.id);
    }

    _applyStyles() {
        this.element.style.cssText = `
            left: ${this.config.left}px;
            top: ${this.config.top}px;
            width: ${this.schema.size ? this.schema.size[0] : ''};
            height: ${this.schema.size ? this.schema.size[1] : ''};
            transform: rotate(${this.config.rotation}deg);
        `;
    }

    _renderContent() {
        if (this.schema.preview) {
            this._renderPreview();
        } else {
            this._renderDefaultView();
        }
    }

    _renderPreview() {
        const img = document.createElement('img'); 
        img.src = `${this.editor.components_path}/${this.schema.preview}`; 
        this.element.appendChild(img);
    }

    _renderDefaultView() {
        this.element.classList.add("base-shield");
        const name = document.createElement("span");
        name.classList.add("_name");
        name.textContent = this.schema.name || this.config.id;
        this.element.appendChild(name);
    }

    _renderPins() {
        this.schema.pins.forEach(pinConfig => {
            const [id, left, top, label] = pinConfig;
            const pin = new Pin(id, left, top, label, this); 
            pin.draw(); 
            this.pins.set(id, pin);
        });
    }

    _attachToDOM() {
        this.editor.componentsContainer.appendChild(this.element);
    }

    // === EVENT LISTENERS ===

    addEventListeners() {
        document.addEventListener("component_update", this._handleUpdateBound);
        this.element.addEventListener('mousedown', this._handleDragStartBound); 
    }

    removeEventListeners() {
        this.element?.removeEventListener('mousedown', this._handleDragStartBound);
        this.editor.container.removeEventListener('mousemove', this._handleDragMoveBound);
        this.editor.container.removeEventListener('mouseup', this._handleDragEndBound);
    }

    // === DRAG HANDLING ===

    _handleUpdate(e){
        if(e.detail.componentID == this.config.id){
            this.config = e.detail.config;
            this._updatePosition();
        }
    }

    _handleDragStart(e) {
        if (e.button != 0 || e.target.closest('.Pin')) return;
        e.stopPropagation();
        fixMouseCoord(e,this.editor.scale, this.editor.view);

        this.setSelected(true, e); 
        this.element.style.cursor = "grabbing";

        this.draggingCoord = {
            x: e.mouseX,
            y: e.mouseY,
            componentX: this.config.left,
            componentY: this.config.top
        };

        this.editor.container.addEventListener('mousemove', this._handleDragMoveBound);
        this.editor.container.addEventListener('mouseup', this._handleDragEndBound);
    }

    _handleDragMove(e) {
        if (!this.draggingCoord) return;
        fixMouseCoord(e,this.editor.scale, this.editor.view);

        const { x: startX, y: startY, componentX, componentY } = this.draggingCoord;

        this.config.left = Math.round(componentX + (e.mouseX - startX));
        this.config.top = Math.round(componentY + (e.mouseY - startY));

        this._updatePosition();
        this._dispatchUpdate();
    }

    _handleDragEnd(e) {
        if (!this.draggingCoord) return;

        this.draggingCoord = null;
        this.element.style.cursor = "grab";

        this.editor.container.removeEventListener('mousemove', this._handleDragMoveBound);
        this.editor.container.removeEventListener('mouseup', this._handleDragEndBound);

        this._updatePosition();
        this._dispatchUpdate();
    }

    // === COLLISION DETECTION ===
    isPointOnPath(clientX, clientY) {
        const rect = getAbsolutePosition(this.element);
        const padding = 4;
        
        return (
            clientX >= rect.left - padding && 
            clientX <= rect.left + padding + this.element.offsetWidth &&
            clientY >= rect.top - padding &&
            clientY <= rect.top + padding + this.element.offsetHeight
        );
    }


    // === TRANSFORMATIONS ===

    _updatePosition() {
        if (!this.element) return;

        this.element.style.left = `${this.config.left}px`;
        this.element.style.top = `${this.config.top}px`;
        this.element.style.transform = `rotate(${this.config.rotation}deg)`;
    }

    _dispatchUpdate(){
        document.dispatchEvent(new CustomEvent("emit_component_update", {
            detail: { componentID: this.config.id, config: this.config }
        }));
    }

    rotate(angleDegrees = 0) {
        this.config.rotation = (this.config.rotation + angleDegrees) % 360;
        if (this.config.rotation < 0) { this.config.rotation += 360; }
        this._updatePosition();
        this._dispatchUpdate();
    }

    // === UI STATE ===

    setSelected(selected, e) {
        if (!this.element) return;
        
        this.element.classList.toggle("selected", selected);
         if (this.element) { this.element.style.zIndex = selected ? 10 : 'unset'; }
        
        if (selected && e.openMenu) {
            this.menu.open(e.clientX, e.clientY);
        } else {
            this.menu.close();
        }
    }

    // === CLEANUP ===

    remove() {
        this.removeEventListeners(); 
        this.element?.remove(); 
        this.pins.forEach(pin => pin.element?.remove());
        this.pins.clear();
        this.menu.close?.(); 
    }

    _dispatchDeleteEvent() {
        document.dispatchEvent(new CustomEvent("emit_component_delete", {
            detail: { componentID: this.config.id }
        }));
    }
}