import { getAbsolutePosition, fixMouseCoord } from "./utils.js";
import { Connection } from "./Connection.js";
import { Component } from "./Component.js";
import { Menu } from "./Menu.js";

const ACTIONS = [
  {
    id: "add_component",
    icon: "./res/Editor/icons/add.svg",
    label: "Aggiungi componente",
    action: (d, e) => {
      e.stopPropagation();
      d.showAddComponentPopup();
    },
  },
  {
    id: "download",
    icon: "./res/Editor/icons/download.svg",
    label: "Scarica diagramma",
    action: (d, e) => {
      d.downloadDiagram();
    },
  },
];

export class Editor {
  get colorList() {
    return [
      "#FF6347",
      "#3CB371",
      "#1E90FF",
      "#FFD700",
      "#BA55D3",
      "#FF8C00",
      "#00CED1",
      "#FF69B4",
    ];
  }

  constructor(container, components_path = "./components/") {
    if (!container) throw new Error("Container non trovato!");
    this.container = container;

    this.view = null;

    this.overlay = null;
    this.componentsContainer = null;
    this.connectionsContainer = null;

    this.components_path = components_path;

    this.components = new Map();
    this.connections = new Map();

    this.translateX = 0;
    this.translateY = 0;
    this.scale = 1;

    this.current_color = 0;

    this.empty_area_menu = new Menu(this);
    this.addComponentPopup = null;

    this._init();
  }

  _init() {
    this._initOverlay();
    this._createViewContainer();
    this._initAddComponentPopup();

    this.empty_area_menu.draw(ACTIONS, this.container);

    const createAndAppendContainer = (className, targetProperty) => {
      const cont = document.createElement("div");
      cont.classList.add(className);
      this.view.appendChild(cont);
      this[targetProperty] = cont;
    };

    createAndAppendContainer("Components-Container", "componentsContainer");
    createAndAppendContainer("Connections-Container", "connectionsContainer");

    this.container.addEventListener("click", (e) => {
      if (e.target.closest(".Editor")) this._initMouseEvents(e, false);
    });
    this.container.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".Editor")) this._initMouseEvents(e, true);
    });

    this._initOperationsEvent();
    this._initPanMouseEvents();
  }

  _createViewContainer() {
    this.view = document.createElement("div");
    this.view.classList.add("View");
    this.container.appendChild(this.view);
  }

  _initOperationsEvent() {
    document.addEventListener("connection_add", async (e) => {
      this._drawConnection(e.detail.config);
    });
    document.addEventListener("connection_delete", (e) => {
      this.connections.get(e.detail.connectionID)?.remove();
      this.connections.delete(e.detail.connectionID);
    });
    document.addEventListener("component_add", async (e) => {
      this._drawComponent(e.detail.config);
    });
    document.addEventListener("component_delete", (e) => {
      this.components.get(e.detail.componentID)?.remove();
      this.components.delete(e.detail.componentID);
    });
  }

  // DOM UTILS
  _initOverlay() {
    this.current_connection_type = "wire";
    this.current_connection_color = this.colorList[0];

    this.overlay = document.createElement("div");
    this.overlay.classList.add("Overlay");

    // Color selector
    const color_overlay = document.createElement("div");
    color_overlay.classList.add("Colors");
    this.overlay.appendChild(color_overlay);

    this.colorList.forEach((c, i) => {
      const e = document.createElement("span");
      e.setAttribute("style", "--color:" + c);
      e.setAttribute("data-color", c);
      if (i == this.current_color) e.classList.add("active");
      e.addEventListener("click", () => {
        this.current_color = i;
        color_overlay.querySelectorAll("span").forEach((c) => {
          c.classList.remove("active");
        });
        e.classList.add("active");
      });
      color_overlay.appendChild(e);
    });

    // Zoom
    const zoom = document.createElement("div");
    zoom.classList.add("Zoom");
    this.overlay.appendChild(zoom);

    const zoom_out = document.createElement("img");
    zoom_out.src = "./res/Editor/icons/zoom_out.svg";
    zoom_out.addEventListener("click", (e) => {
      this.scale = Math.max(0.25, this.scale - 0.05);
      document.dispatchEvent(new Event("zoom_change"));
      this._applyTransform();
    });
    zoom.appendChild(zoom_out);

    const label = document.createElement("span");
    label.textContent = "100%";
    document.addEventListener("zoom_change", (e) => {
      label.textContent = Math.round(this.scale * 100) + "%";
    });
    zoom.appendChild(label);

    const zoom_in = document.createElement("img");
    zoom_in.src = "./res/Editor/icons/zoom_in.svg";
    zoom_in.addEventListener("click", (e) => {
      this.scale = Math.max(0.25, this.scale + 0.05);
      document.dispatchEvent(new Event("zoom_change"));
      this._applyTransform();
    });
    zoom.appendChild(zoom_in);

    this.container.appendChild(this.overlay);
  }
  _initAddComponentPopup() {
    this.addComponentPopup = document.createElement("div");
    this.addComponentPopup.classList.add("Popup");

    const container = document.createElement("div");
    container.classList.add("container");
    this.addComponentPopup.appendChild(container);

    const title = document.createElement("h1");
    title.textContent = "Seleziona componente";
    container.appendChild(title);

    const components_list = this.getComponentsList();
    components_list.forEach((i) => {
      const item = document.createElement("span");
      item.classList.add("Item");
      item.textContent = i.name;
      item.addEventListener("click", async (e) => {
        document.dispatchEvent(
          new CustomEvent("emit_component_add", {
            detail: {
              config: {
                id: "component_" + Date.now(),
                type: i.type,
                rotation: 0,
                left: e.clientX,
                top: e.clientY,
              },
            },
          })
        );
        this.addComponentPopup.style.display = "none";
      });
      container.appendChild(item);
    });

    this.container.addEventListener("click", (e) => {
      if (e.target.closest(".container")) return;
      this.addComponentPopup.style.display = "none";
    });
    this.container.appendChild(this.addComponentPopup);
  }
  _drawComponents() {
    this.components.forEach((c) => c.remove());
    this.components.clear();
    this.diagram.components.forEach((c) => this._drawComponent(c));
  }
  _drawComponent(config) {
    const comp_obj = new Component(config, this);
    this.components.set(config.id, comp_obj);
    comp_obj.draw();
  }
  _drawConnections() {
    this.connections.forEach((c) => c.remove());
    this.connections.clear();
    this.diagram.connections.forEach((c) => this._drawConnection(c));
  }
  _drawConnection(config) {
    const connection = new Connection(config, this);
    this.connections.set(config.id, connection);
    connection.draw();
  }

  showAddComponentPopup() {
    this.empty_area_menu.element.style.display = "none";
    this.addComponentPopup.style.display = "flex";
  }

  // MOUSE ITEMS CLICK
  _initMouseEvents(e, openMenu) {
    e.preventDefault();
    e.stopPropagation();
    fixMouseCoord(e, this.scale, this.view);

    this.connections.forEach((c) => c.setSelected(false, null));
    this.components.forEach((c) => c.setSelected(false, null));
    this.empty_area_menu.close();

    if (e.target.closest("line") || e.target.closest("circle")) {
      const c = this.connections.get(
        e.target.closest("svg").getAttribute("data-conn-id")
      );
      e.openMenu = openMenu;
      c.setSelected(true, e);
      return false;
    }

    if (e.target.closest(".Component")) {
      const c = this.components.get(
        e.target.closest(".Component").getAttribute("data-component-id")
      );
      e.openMenu = openMenu;
      c.setSelected(true, e);
      return false;
    }

    if (openMenu) {
      this.empty_area_menu.open(e.clientX, e.clientY);
    } else {
      this.empty_area_menu.close();
    }
  }

  // PAN HANDLERS
  _initPanMouseEvents() {
    this.container.addEventListener("mousedown", (e) => {
      if (e.button == 0) this._handlePanStart(e);
    });
    this.container.addEventListener("mousemove", (e) => {
      this._handlePanMove(e);
    });
    this.container.addEventListener("mouseup", (e) => {
      this._handlePanEnd(e);
    });
    this.container.addEventListener(
      "wheel",
      (e) => {
        this._handleZoom(e);
      },
      { passive: false }
    );
  }
  _applyTransform() {
    this.view.style.transform =
      "translate(" +
      this.translateX +
      "px , " +
      this.translateY +
      "px) scale(" +
      this.scale +
      ")";
  }
  _handleZoom(e) {
    const scaleFactor = 1.1;
    const delta = e.deltaY > 0 ? 1 / scaleFactor : scaleFactor;
    const newScale = Math.max(0.25, Math.min(4, this.scale * delta));
    if (newScale === this.scale) return;

    const containerRect = getAbsolutePosition(this.view);

    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    const focalPointX = (mouseX - this.translateX) / this.scale;
    const focalPointY = (mouseY - this.translateY) / this.scale;

    this.scale = newScale;

    this.translateX = mouseX - focalPointX * this.scale;
    this.translateY = mouseY - focalPointY * this.scale;

    document.dispatchEvent(new Event("zoom_change"));

    this._applyTransform();
  }
  _handlePanStart(e) {
    if (e.target.closest(".Popup")) return;
    this.isPanning = true;
    this.container.style.cursor = "grabbing";
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
  }
  _handlePanMove(e) {
    if (!this.isPanning) return;

    const dx = e.clientX - this.panStartX;
    const dy = e.clientY - this.panStartY;

    this.translateX += dx;
    this.translateY += dy;

    this.panStartX = e.clientX;
    this.panStartY = e.clientY;

    this._applyTransform();
  }
  _handlePanEnd(e) {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.container.style.cursor = "unset";
  }

  // DATA UTILS
  async loadDiagram(diagram) {
    if (!("components" in diagram) || !("connections" in diagram)) return;
    this.diagram = JSON.parse(JSON.stringify(diagram));
    this._drawComponents();
    this._drawConnections();
  }

  getComponentsList() {
    return [
      { type: "esp32", name: "Espressif - Esp32" },
      { type: "lora_board", name: "Archimede - Lora board" },
      { type: "custom", name: "Archimede - Custom board" },
    ];
  }

  printDiagram() {
    console.log(this.components, this.connections);
  }

  _getDiagram() {
    const components = [];
    const connections = [];

    this.components.forEach((c) => {
      components.push(c.config);
    });
    this.connections.forEach((c) => {
      connections.push(c.config);
    });

    return { components: components, connections: connections };
  }

  downloadDiagram(filename = "diagram.json") {
    const jsonString = JSON.stringify(this._getDiagram());
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
