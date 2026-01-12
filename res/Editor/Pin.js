import { fixMouseCoord, getAbsolutePosition } from "./utils.js";
import { TempConnection } from "./Connection.js";

export class Pin {
  constructor(id, left, top, label = null, component) {
    this.id = id;
    this.left = left;
    this.top = top;
    this.label = label;
    this.component = component;
    this.element = null;
    this.temp_connection = null;

    this._bindEventHandlers();
  }

  // === CONSTANTS ===

  get PIN_RADIUS() {
    return 0;
  }

  // === GETTERS ===

  get refID() {
    return `${this.component.config.id}:${this.id}`;
  }
  get position() {
    const pos = getAbsolutePosition(this.element);
    return {
      x: pos.left + this.PIN_RADIUS,
      y: pos.top + this.PIN_RADIUS,
    };
  }

  // === INITIALIZATION ===

  _bindEventHandlers() {
    this._handleDragStartBound = this._handleDragStart.bind(this);
    this._handleDragMoveBound = this._handleDragMove.bind(this);
    this._handleDragEndBound = this._handleDragEnd.bind(this);
  }

  // === RENDERING ===

  draw() {
    this._cleanup();
    this._createElement();
    this._applyStyles();
    this._renderLabel();
    this._attachToDOM();
    this.addEventListeners();
  }

  _cleanup() {
    this.element?.remove();
  }

  _createElement() {
    this.element = document.createElement("div");
    this.element.classList.add("Pin");
    this.element.setAttribute("data-pin-id", this.id);
  }

  _applyStyles() {
    this.element.style.left = `${this.left}px`;
    this.element.style.top = `${this.top}px`;
  }

  _renderLabel() {
    const label = document.createElement("span");
    label.classList.add("Label");
    label.textContent = this.label || this.id;
    this.element.appendChild(label);
  }

  _attachToDOM() {
    this.component.element.appendChild(this.element);
  }

  // === EVENT LISTENERS ===

  addEventListeners() {
    this.element.addEventListener("mousedown", this._handleDragStartBound);
  }

  removeEventListeners() {
    this.element?.removeEventListener("mousedown", this._handleDragStartBound);
    this.component.editor.view.removeEventListener(
      "mousemove",
      this._handleDragMoveBound
    );
    this.component.editor.view.removeEventListener(
      "mouseup",
      this._handleDragEndBound
    );
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

  // === DRAG HANDLING ===

  _handleDragStart(e) {
    e.stopPropagation();
    this.component.editor.container.style.cursor = "crosshair";
    this._createTempConnection();
    this._attachDragListeners();
  }

  _createTempConnection() {
    const color =
      this.component.editor.colorList[this.component.editor.current_color];

    this.temp_connection = new TempConnection(
      {
        from: this,
        color: color,
      },
      this.component.editor.connectionsContainer
    );
  }

  _attachDragListeners() {
    this.component.editor.container.addEventListener(
      "mousemove",
      this._handleDragMoveBound
    );
    this.component.editor.container.addEventListener(
      "mouseup",
      this._handleDragEndBound
    );
  }

  _handleDragMove(e) {
    if (!this.temp_connection) return;
    //e.stopPropagation();
    fixMouseCoord(e, this.component.editor.scale, this.component.editor.view);
    this.temp_connection.update(e.mouseX, e.mouseY);
  }

  _handleDragEnd(event) {
    if (!this.temp_connection) return;

    fixMouseCoord(
      event,
      this.component.editor.scale,
      this.component.editor.view
    );
    this.component.editor.container.style.cursor = "unset";

    const targetPin = this._findTargetPin(event.mouseX, event.mouseY);

    if (
      targetPin &&
      targetPin.refID != this.temp_connection.config.from.refID
    ) {
      document.dispatchEvent(
        new CustomEvent("emit_connection_add", {
          detail: {
            config: {
              id: "connection_" + Date.now(),
              from: this.temp_connection.config.from.refID,
              to: targetPin.refID,
              type: "wire",
              color: this.temp_connection.config.color,
              constrains: [],
            },
          },
        })
      );
    }

    this._cleanupTempConnection();
    this._detachDragListeners();
  }

  _findTargetPin(mouseX, mouseY) {
    let targetPin = null;

    this.component.editor.components.forEach((component) => {
      if (component.isPointOnPath(mouseX, mouseY)) {
        component.pins.forEach((pin) => {
          if (pin.isPointOnPath(mouseX, mouseY)) {
            targetPin = pin;
          }
        });
      }
    });

    return targetPin;
  }

  _cleanupTempConnection() {
    this.temp_connection.remove();
    this.temp_connection = null;
  }

  _detachDragListeners() {
    this.component.editor.container.removeEventListener(
      "mousemove",
      this._handleDragMoveBound
    );
    this.component.editor.container.removeEventListener(
      "mouseup",
      this._handleDragEndBound
    );
  }
}
