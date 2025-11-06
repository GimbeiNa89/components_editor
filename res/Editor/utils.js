export function extractRotationAngle(transformValue) {
    if (!transformValue || transformValue === 'none') {
        return 0;
    }

    const rotateMatch = transformValue.match(/rotate\(([^)]+)\)/);
    if (rotateMatch) {
        const angleStr = rotateMatch[1];
        if (angleStr.includes('deg')) {
            return (parseFloat(angleStr) * Math.PI) / 180;
        }
    }

    const matrixMatch = transformValue.match(/matrix\(([^)]+)\)/);
    if (matrixMatch) {
        const values = matrixMatch[1].split(',').map(v => parseFloat(v));
        if (values.length === 6) { return Math.atan2(values[1], values[0]); }
    }

    return 0;
}

export function getAbsolutePosition(element) {
    if (!element) { return {left: 0, top: 0}; }

    let currentLeft = element.offsetLeft;
    let currentTop = element.offsetTop;
    
    const parent = element.offsetParent;
    const parentPosition = getAbsolutePosition(parent);

    let finalLeft = currentLeft + parentPosition.left;
    let finalTop = currentTop + parentPosition.top;

    if (parent && parent.nodeType === 1) {
        const style = window.getComputedStyle(parent);
        const transform = style.getPropertyValue("transform");
        const angleInRadians = extractRotationAngle(transform);

        if (angleInRadians !== 0) {
            const origin = style.getPropertyValue("transform-origin").split(' ').map(v => parseFloat(v));
            const originX = origin[0] || parent.offsetWidth / 2;
            const originY = origin[1] || parent.offsetHeight / 2;
            
            let relativeX = currentLeft - originX;
            let relativeY = currentTop - originY;
            
            const cos = Math.cos(angleInRadians);
            const sin = Math.sin(angleInRadians);

            const rotatedX = relativeX * cos - relativeY * sin;
            const rotatedY = relativeX * sin + relativeY * cos;
            
            finalLeft = rotatedX + parentPosition.left + originX;
            finalTop = rotatedY + parentPosition.top + originY;
        }
    }

    return {left: finalLeft, top: finalTop};
}

export function fixMouseCoord(e, scale, container){
    const rect = container.getBoundingClientRect();
    const scaleFactor = scale;
    const mouseX_relative = e.clientX - rect.left;
    const mouseY_relative = e.clientY - rect.top;

    e.mouseX = mouseX_relative / scaleFactor;
    e.mouseY = mouseY_relative / scaleFactor;
}

export function getJsonFileFromPath(filePath){
    var xmlhttp=new XMLHttpRequest();
    xmlhttp.open("GET",filePath,false);
    xmlhttp.overrideMimeType("application/json");
    xmlhttp.send();
    if (xmlhttp.status==200 && xmlhttp.readyState == 4 ){
        return JSON.parse(xmlhttp.responseText);
    } else {
        return null;
    }
}