export class Menu{
    constructor(data){
        this.element = null;
        this.data = data;
        this.items = new Map();
    }

    draw(items, container){
        if(this.element){ this.element.remove()}

        this.element = document.createElement("div");
        this.element.classList.add("Menu","MenuList");
        items.forEach(item => {
            const el = document.createElement("div");
            el.classList.add("Item");
            if(item.id) this.items.set(item.id, el);
            if(item.color){ el.setAttribute("style","--color:"+item.color);}
            if(item.icon){ 
                const icon = document.createElement("img");
                icon.src = item.icon;
                el.appendChild(icon);
            }
            
            const label = document.createElement("span");
            label.textContent = item.label;
            el.appendChild(label);

            el.addEventListener("click", (e) => {item.action(this.data, e)})
            this.element.appendChild(el);
        });

        container.appendChild(this.element);
    }

    get position(){
        return {x: this.element.offsetLeft, y: this.element.offsetTop};
    }

    open(posX, posY){
        if(this.element){
            this.element.style.display = "flex";
            this.element.style.left = posX;
            this.element.style.top = posY;
        }
    }

    close(){
        if(this.element) this.element.style.display = "none";
    }

    remove(){
        if(this.element) this.element.remove();
    }
}
