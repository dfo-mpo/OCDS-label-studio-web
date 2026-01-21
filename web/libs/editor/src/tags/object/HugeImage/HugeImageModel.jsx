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
  })
  .actions((self) => ({
    // Override parent setZoom - must be defined first
    setZoom(scale) {
      scale = clamp(scale, 1, Number.POSITIVE_INFINITY);
      self.currentZoom = scale;

      const maxScale = self.maxScale;
      const coverScale = self.coverScale;

      if (maxScale > 1) {
        // image > container
        if (scale < maxScale) {
          self.stageZoom = scale;
          self.zoomScale = 1;
        } else {
          self.stageZoom = maxScale;
          self.zoomScale = scale / maxScale;
        }
      } else {
        // image < container
        if (scale > maxScale) {
          self.stageZoom = maxScale;
          self.zoomScale = scale;
        } else {
          self.stageZoom = scale;
          self.zoomScale = 1;
        }
      }

      //this is used for getting canvassize and thats it
      //but it looks like its needed for making seadragon the right size
      //and the canvas the right size
      if (self.zoomScale > 1) {
        const z = Math.min(maxScale * self.zoomScale, coverScale);

        if (self.containerWidth / self.naturalWidth > self.containerHeight / self.naturalHeight) {
          self.stageZoomX = z;
          self.stageZoomY = self.stageZoom;
        } else {
          self.stageZoomX = self.stageZoom;
          self.stageZoomY = z;
        }
      } else {
        self.stageZoomX = self.stageZoom;
        self.stageZoomY = self.stageZoom;
      }
    },

    setZoomPosition(x, y) {
      //console.log("Set zoom position")
      const [width, height] = isFF(FF_DEV_3377)
        ? [self.canvasSize.width, self.canvasSize.height]
        : [self.containerWidth, self.containerHeight];

      const [minX, minY] = [
        width - self.stageComponentSize.width * self.zoomScale,
        height - self.stageComponentSize.height * self.zoomScale,
      ];

      self.zoomingPositionX = clamp(x, minX, 0);
      self.zoomingPositionY = clamp(y, minY, 0);
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

    setZoomLimits({ minZoom, maxZoom, homeZoom }) {
      this.minZoom = minZoom;
      this.maxZoom = maxZoom;
      this.homeZoom = homeZoom;
    },

    afterAttach() {
      console.log("After attach");
      
      self.manager = ToolsManager.getInstance({ name: self.name });
      const manager = self.manager;
      const env = { manager, control: self };

      // Add standard image tools
      if (self.selectionControl) manager.addTool("MoveTool", Tools.Selection.create({}, env), "MoveTool");
      if (self.zoomControl) manager.addTool("ZoomPanTool", Tools.Zoom.create({}, env), "ZoomPanTool");
      if (self.brightnessControl) manager.addTool("BrightnessTool", Tools.Brightness.create({}, env), "BrightnessTool");
      if (self.contrastControl) manager.addTool("ContrastTool", Tools.Contrast.create({}, env), "ContrastTool");
      if (self.saturationControl) manager.addTool("SaturationTool", Tools.Saturation.create({}, env), "SaturationTool");
      if (self.invertControl) manager.addTool("InvertTool", Tools.Invert.create({}, env), "InvertTool");
      if (self.rotateControl) manager.addTool("RotateTool", Tools.Rotate.create({}, env), "RotateTool");
    },

    getToolsManager() {
      return self.manager;
    },

    onMouseDown(x, y, event) {
      const activeTool = self.manager?.activeTool;
      if (activeTool?.onMouseDown) {
        activeTool.onMouseDown({ x, y, originalEvent: event.originalEvent });
      }
    },

    onMouseUp(x, y, event) {
      const activeTool = self.manager?.activeTool;
      if (activeTool?.onMouseUp) {
        activeTool.onMouseUp({ x, y, originalEvent: event.originalEvent });
      }
    },

    onClick(x, y, event) {
      const activeTool = self.manager?.activeTool;
      if (activeTool?.onClick) {
        activeTool.onClick({ x, y, originalEvent: event.originalEvent });
      }
    },

    onMouseMove(x, y, event) {
      const activeTool = self.manager?.activeTool;
      if (activeTool?.onMouseMove) {
        activeTool.onMouseMove({ x, y, originalEvent: event.originalEvent });
      }
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