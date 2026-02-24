// HugeImage.js - Simple implementation using existing ImageModel

import { inject } from "mobx-react";
import Registry from "../../../core/Registry";
import { ImageModel } from "../Image/Image";
import SeadragonView from "./HugeImageView";
import * as Tools from "../../../tools";
import ToolsManager from "../../../tools/Manager";
import { clamp, isDefined } from "../../../utils/utilities";
import { destroy, getRoot, getType, types } from "mobx-state-tree";
import { BrushRegionModel } from "../../../regions/BrushRegion";
import { EllipseRegionModel } from "../../../regions/EllipseRegion";
import { KeyPointRegionModel } from "../../../regions/KeyPointRegion";
import { PolygonRegionModel } from "../../../regions/PolygonRegion";
import { RectRegionModel } from "../../../regions/RectRegion";
import OpenSeadragon from "openseadragon";


import {
  FF_DEV_3377,
  FF_DEV_3391,
  FF_DEV_3793,
  FF_LSDV_4583,
  FF_LSDV_4583_6,
  FF_LSDV_4711,
  FF_ZOOM_OPTIM,
  isFF,
} from "../../../utils/feature-flags";

const HugeImageModel = ImageModel.named("HugeImageModel")
  .props({
    type: "hugeimage",
    minZoom: 0,
    maxZoom: 300,
    homeZoom: 1,
    _canvasWidth: 1,
    _canvasHeight: 1,
    
    // override default rect size
    defaultrectheight: types.optional(types.string, "1.0"),
    defaultrectwidth: types.optional(types.string, "1.0"),
    zoomcontrol: types.optional(types.boolean, false),
  })
  .volatile(() => ({
    viewer: null,
    stageRef: null,
    dragBoundFunc: null,
  }))
  .actions((self) => ({

    //override setStage

    setStageRef(ref) {
      
      if(ref == null){
        console.log("ref null")
      }
      self.stageRef = ref;
      const currentTool = self.getToolsManager().findSelectedTool();

      currentTool?.updateCursor?.();
    },

    //override canvas-internal transformations
    canvasToInternalX(n) {
      //RELTAIVE_STAGE_WIDTH is 100 normally
      //and since the canvas is now 0-100, we dont want anything happening with stage width
      //this seems primarily used for the rect regions to know how wide they should be

      //return (n / self.stageWidth) * RELATIVE_STAGE_WIDTH;
      return n
    },

    canvasToInternalY(n) {
      //return (n / self.stageHeight) * RELATIVE_STAGE_HEIGHT;


      
      return n
    },

    internalToCanvasX(n) {
      //return (n / RELATIVE_STAGE_WIDTH) * self.stageWidth;
      return n
    },

    internalToCanvasY(n) {
      //return (n / RELATIVE_STAGE_HEIGHT) * self.stageHeight;
      return n
    },

    // Override parent setZoom - must be defined first
    setZoom(scale) {
      //i dont see stageZoom being used by anything other than Image.js
      //so the region code must be zoomScale
      
      self.zoomScale = 0.1
    },

    setZoomPosition(x, y) {
      //console.log("Set zoom position")
      // const [width, height] = isFF(FF_DEV_3377)
      //   ? [self.canvasSize.width, self.canvasSize.height]
      //   : [self.containerWidth, self.containerHeight];

      // const [minX, minY] = [
      //   width - self.stageComponentSize.width * self.zoomScale,
      //   height - self.stageComponentSize.height * self.zoomScale,
      // ];

      // self.zoomingPositionX = clamp(x, minX, 0);
      // self.zoomingPositionY = clamp(y, minY, 0);
    },

    resetZoomPositionToCenter() {
      const { stageComponentSize, zoomScale } = self;
      const { width, height } = stageComponentSize;

      const [containerWidth, containerHeight] = isFF(FF_DEV_3377)
        ? [self.canvasSize.width, self.canvasSize.height]
        : [self.containerWidth, self.containerHeight];

      self.setZoomPosition((containerWidth - width * zoomScale) / 2, (containerHeight - height * zoomScale) / 2);
    },


    //override other zooming functions
    
    sizeToFit() {
      const { maxScale } = self;

      self.defaultzoom = "fit";
      self.setZoom(1);
      self.updateImageAfterZoom();
      self.resetZoomPositionToCenter();
    },

    sizeToOriginal() {
      const { maxScale } = self;

      self.defaultzoom = "original";
      self.setZoom(self.homeZoom);
      self.updateImageAfterZoom();
      self.resetZoomPositionToCenter();
    },

    sizeToAuto() {
      self.defaultzoom = "auto";
      self.setZoom(self.minZoom);
      self.updateImageAfterZoom();
      self.resetZoomPositionToCenter();
    },

    //override fixZoomedCoords
    // convert screen coords to image coords considering zoom
    fixZoomedCoords([x, y]) {
      return [x, y];
    },

    //override zoomOriginalCoords 
    // convert image coords to screen coords considering zoom
    zoomOriginalCoords([x, y]) {
      //const p = self.stageRef.getAbsoluteTransform().point({ x, y });
      return [x, y];
    },

    //override event function
    event(name, ev, internalX, internalY) {
      //const [canvasX, canvasY] = self.fixZoomedCoords([screenX, screenY]);

      // const x = self.canvasToInternalX(canvasX);
      // const y = self.canvasToInternalY(canvasY);

      const canvasX = internalX*100
      const canvasY = internalY*100
      const toolsManager = self.getToolsManager() 
      //toolsManager.event(name, ev.evt || ev, internalX, internalY, canvasX, canvasY);
      toolsManager.event(name, ev.evt || ev, canvasX, canvasY);
    },

   _recalculateImageParams() {
      self.stageWidth = isFF(FF_DEV_3377)
        ? self.naturalWidth * self.stageZoom
        : Math.round(self.naturalWidth * self.stageZoom);
      self.stageHeight = isFF(FF_DEV_3377)
        ? self.naturalHeight * self.stageZoom
        : Math.round(self.naturalHeight * self.stageZoom);
    },

    _updateImageSize({ width, height, userResize }) {
      if (self.naturalWidth === undefined) {
        return;
      }
      if (width > 1 && height > 1) {
        const prevWidth = self.canvasSize.width;
        const prevHeight = self.canvasSize.height;
        const prevStageZoom = self.stageZoom;
        const prevZoomScale = self.zoomScale;

        self.containerWidth = width;
        self.containerHeight = height;

        // reinit zoom to calc stageW/H
        self.setZoom(self.currentZoom);

        self._recalculateImageParams();

        const zoomChangeRatio = self.stageZoom / prevStageZoom;
        const scaleChangeRatio = self.zoomScale / prevZoomScale;
        const changeRatio = zoomChangeRatio * scaleChangeRatio;

        self.setZoomPosition(
          self.zoomingPositionX * changeRatio + (self.canvasSize.width / 2 - (prevWidth / 2) * changeRatio),
          self.zoomingPositionY * changeRatio + (self.canvasSize.height / 2 - (prevHeight / 2) * changeRatio),
        );
      }

      self.sizeUpdated = true;
      self._updateRegionsSizes({
        width: self.stageWidth,
        height: self.stageHeight,
        naturalWidth: self.naturalWidth,
        naturalHeight: self.naturalHeight,
        userResize,
      });
    },
    

    _updateRegionsSizes({ width, height, naturalWidth, naturalHeight, userResize }) {
      const _historyLength = self.annotation?.history?.history?.length;

      self.annotation.history.freeze();

      self.regions.forEach((shape) => {
        shape.updateImageSize(width / naturalWidth, height / naturalHeight, width, height, userResize);
      });
      self.regs.forEach((shape) => {
        shape.updateImageSize(width / naturalWidth, height / naturalHeight, width, height, userResize);
      });
      self.drawingRegion?.updateImageSize(width / naturalWidth, height / naturalHeight, width, height, userResize);

      setTimeout(self.annotation.history.unfreeze, 0);

      //sometimes when user zoomed in, annotation was creating a new history. This fix that in case the user has nothing in the history yet
      if (_historyLength <= 1) {
        // Don't force unselection of regions during the updateObjects callback from history reinit
        setTimeout(() => self.annotation?.reinitHistory(false), 0);
      }
    },

    updateImageSize(ev) {

      console.log("Update image size")

      const { naturalWidth, naturalHeight } = self.imageRef ?? ev.target;
      const { offsetWidth, offsetHeight } = self.viewer.container;

      self.naturalWidth = naturalWidth;
      self.naturalHeight = naturalHeight;

      self._updateImageSize({ width: offsetWidth, height: offsetHeight });
      // after regions' sizes adjustment we have to reset all saved history changes
      // mobx do some batch update here, so we have to reset it asynchronously
      // this happens only after initial load, so it's safe
      self.setReady(true);

      if (self.defaultzoom === "fit") {
        self.sizeToFit();
      } else {
        self.sizeToAuto();
      }
      // Don't force unselection of regions during the updateObjects callback from history reinit
      setTimeout(() => self.annotation?.reinitHistory(false), 0);
    },

    //override the handle zoom function
    handleZoom(val, mouseRelativePos = { x: self.canvasSize.width / 2, y: self.canvasSize.height / 2 }) {
      
      //val is +1 for zoom in and -1 for zoom out
      //and then mouseRelativePos i guess is supposed to be where to zoo minto

      if (val) {
        let zoomScale = self.currentZoom;

        zoomScale = val > 0 ? zoomScale * self.zoomBy : zoomScale / self.zoomBy;
        if (self.negativezoom !== true && zoomScale <= 1) {
          self.setZoom(1);
          self.setZoomPosition(0, 0);
          self.updateImageAfterZoom();
          return;
        }
        if (zoomScale <= 1) {
          self.setZoom(zoomScale);
          self.setZoomPosition(0, 0);
          self.updateImageAfterZoom();
          return;
        }

        // DON'T TOUCH THIS
        let stageScale = self.zoomScale;

        const mouseAbsolutePos = {
          x: (mouseRelativePos.x - self.zoomingPositionX) / stageScale,
          y: (mouseRelativePos.y - self.zoomingPositionY) / stageScale,
        };

        self.setZoom(zoomScale);

        stageScale = self.zoomScale;

        const zoomingPosition = {
          x: -(mouseAbsolutePos.x - mouseRelativePos.x / stageScale) * stageScale,
          y: -(mouseAbsolutePos.y - mouseRelativePos.y / stageScale) * stageScale,
        };

        self.setZoomPosition(zoomingPosition.x, zoomingPosition.y);
        self.updateImageAfterZoom();
      }
    },

    setViewer(viewer) {
      self._viewer = viewer;
    },
    
    updateCanvasSize(width, height){
      self._canvasWidth = width
      self._canvasHeight = height
    },

    afterAttach() {
      console.log("After attach");
      
      self.manager = ToolsManager.getInstance({ name: self.name });
      const manager = self.manager;
      const env = { manager, control: self };

      //because canvas is now 100x100 internal
      //and the rendered is nunya business
      //we just use viewport 0-1 coordinates

      // Add standard image tools
      if (self.selectionControl) manager.addTool("MoveTool", Tools.Selection.create({}, env), "MoveTool");
      //if (self.zoomControl) manager.addTool("ZoomPanTool", Tools.Zoom.create({}, env), "ZoomPanTool");
      if (self.brightnessControl) manager.addTool("BrightnessTool", Tools.Brightness.create({}, env), "BrightnessTool");
      if (self.contrastControl) manager.addTool("ContrastTool", Tools.Contrast.create({}, env), "ContrastTool");
      if (self.saturationControl) manager.addTool("SaturationTool", Tools.Saturation.create({}, env), "SaturationTool");
      if (self.invertControl) manager.addTool("InvertTool", Tools.Invert.create({}, env), "InvertTool");
      if (self.rotateControl) manager.addTool("RotateTool", Tools.Rotate.create({}, env), "RotateTool");
    },

    getToolsManager() {
      return self.manager;
    },
    // onMouseDown(x, y, event) {
    //   const activeTool = self.manager?.activeTool;
    //   if (activeTool?.onMouseDown) {
    //     activeTool.onMouseDown({ x, y, originalEvent: event.originalEvent });
    //   }
    // },

    // onMouseUp(x, y, event) {
    //   const activeTool = self.manager?.activeTool;
    //   if (activeTool?.onMouseUp) {
    //     activeTool.onMouseUp({ x, y, originalEvent: event.originalEvent });
    //   }
    // },

    // onClick(x, y, event) {
    //   const activeTool = self.manager?.activeTool;
    //   if (activeTool?.onClick) {
    //     activeTool.onClick({ x, y, originalEvent: event.originalEvent });
    //   }
    // },

    // onMouseMove(x, y, event) {
    //   const activeTool = self.manager?.activeTool;
    //   if (activeTool?.onMouseMove) {
    //     activeTool.onMouseMove({ x, y, originalEvent: event.originalEvent });
    //   }
    // },

    setDragBoundFunc(func){
      self.dragBoundFunc = func
    },

    focusOnRegion(region) {
      if (!self.viewer?.viewport || !region) return;
      // Convert region coordinates from percentages to actual image coordinates
      
      const {left, top, right, bottom} = region.bboxCoords
      
      const width = right - left
      const height = bottom - top

      const regionCenterX = (left + width / 2) / 100.0;
      const regionCenterY = (top + height / 2) / 100.0;
      
      const regionCoverageX = width / 100.0;
      const regionCoverageY = height / 100.0;

      let marginx = 0.12*width/100+0.001
      let marginy = 0.12*height/100+0.001
      
      self.viewer.viewport.fitBoundsWithConstraints(new OpenSeadragon.Rect(
        regionCenterX - regionCoverageX / 2 - marginx,
        regionCenterY - regionCoverageY / 2 - marginy,
        regionCoverageX + marginx * 2,
        regionCoverageY + marginy * 2
      ), true);
    },

  }))
  .views((self) => ({



    //override canvasSize
    //why is the function for getting the canvas size even on the model side?
    //it has no idea what rendering looks like
    //and so it has no reference to viewerRef
    //this is terrible code
    get canvasSize() {
      return {
        width: self._canvasWidth,
        height: self._canvasHeight
      }
      // if (self.isSideways) {
      //   return {
      //     width: isFF(FF_DEV_3377)
      //       ? self.naturalHeight * self.stageZoomX
      //       : Math.round(self.naturalHeight * self.stageZoomX),
      //     height: isFF(FF_DEV_3377)
      //       ? self.naturalWidth * self.stageZoomY
      //       : Math.round(self.naturalWidth * self.stageZoomY),
      //   };
      // }

      // return {
      //   width: isFF(FF_DEV_3377)
      //     ? self.naturalWidth * self.stageZoomX
      //     : Math.round(self.naturalWidth * self.stageZoomX),
      //   height: isFF(FF_DEV_3377)
      //     ? self.naturalHeight * self.stageZoomY
      //     : Math.round(self.naturalHeight * self.stageZoomY),
      // };
    },

    get viewer() {
      return self._viewer;
    },

    //override this function
    //its for finding if a region is visible
    //it computes its bounding box, then the viewport bounding box
    //it looks like onva region  inViewport is the only thing that uses the function
    get viewPortBBoxCoords() {
      let width = self.canvasSize.width / self.zoomScale;
      let height = self.canvasSize.height / self.zoomScale;
      const leftOffset = -self.zoomingPositionX / self.zoomScale;
      const topOffset = -self.zoomingPositionY / self.zoomScale;
      const rightOffset = self.stageComponentSize.width - (leftOffset + width);
      const bottomOffset = self.stageComponentSize.height - (topOffset + height);
      const offsets = [leftOffset, topOffset, rightOffset, bottomOffset];

      if (self.isSideways) {
        [width, height] = [height, width];
      }
      if (self.rotation) {
        const rotateCount = (self.rotation / 90) % 4;

        for (let k = 0; k < rotateCount; k++) {
          offsets.push(offsets.shift());
        }
      }
      const left = offsets[0];
      const top = offsets[1];

      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
      };
    },
  }));

// Inject store into your view
const HtxHugeImage = inject("store")(SeadragonView);

// Register with the new tag name
Registry.addTag("hugeimage", HugeImageModel, HtxHugeImage);
Registry.addObjectType(HugeImageModel);

// Register all region types that work with HugeImage
Registry.addRegionType(
  BrushRegionModel, 
  "hugeimage", 
  (value) => value.rle || value.touches || value.maskDataURL
);

Registry.addRegionType(RectRegionModel, "hugeimage");

Registry.addRegionType(PolygonRegionModel, "hugeimage", (value) => !!value.points);

Registry.addRegionType(EllipseRegionModel, "hugeimage");

Registry.addRegionType(
  KeyPointRegionModel,
  "hugeimage",
  (value) => "x" in value && "y" in value && "width" in value && !("height" in value)
);

export { HugeImageModel, HtxHugeImage };