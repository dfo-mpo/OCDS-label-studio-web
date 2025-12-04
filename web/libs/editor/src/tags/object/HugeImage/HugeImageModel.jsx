// HugeImage.js - Simple implementation using existing ImageModel

import { inject } from "mobx-react";
import Registry from "../../../core/Registry";
import { ImageModel } from "../Image/Image"; // Import the existing model
import SeadragonView from "./HugeImageView";
import * as Tools from "../../../tools";
import ToolsManager from "../../../tools/Manager";
import { destroy, getRoot, getType, types } from "mobx-state-tree";
import { BrushRegionModel } from "../../../regions/BrushRegion";
import { EllipseRegionModel } from "../../../regions/EllipseRegion";
import { KeyPointRegionModel } from "../../../regions/KeyPointRegion";
import { PolygonRegionModel } from "../../../regions/PolygonRegion";
import { RectRegionModel } from "../../../regions/RectRegion";
import { DrawingRegion } from "../Image/DrawingRegion";
import { ImageSelection } from "../Image/ImageSelection";

import {
  // FF_DEV_3377,
  // FF_DEV_3391,
  // FF_DEV_3793,
  // FF_LSDV_4583,
  // FF_LSDV_4583_6,
  // FF_LSDV_4711,
  // FF_ZOOM_OPTIM,
  isFF,
} from "../../../utils/feature-flags";

// Just use the existing ImageModel, but change the tag name and type
const HugeImageModel = ImageModel.named("HugeImageModel").props({
  type: "hugeimage" // Only change the type
  //mode: types.optional(types.enumeration(["drawing", "viewing", "brush", "eraser"]), "viewing"),
    
  //sizeUpdated: types.optional(types.boolean, false),

  /**
   * Cursor coordinates
   */
  //cursorPositionX: types.optional(types.number, 0),
  //cursorPositionY: types.optional(types.number, 0),

  //brushControl: types.optional(types.string, "brush"),

  //brushStrokeWidth: types.optional(types.number, 15),

  //drawingRegion: types.optional(DrawingRegion, null),
  //selectionArea: types.optional(ImageSelection, { start: null, end: null }),
  //regions: types.array(
  //  types.union(BrushRegionModel, RectRegionModel, EllipseRegionModel, PolygonRegionModel, KeyPointRegionModel),
  //  [], )

  
})
  .actions((self) => ({
    afterAttach() {
      
    console.log("After attach")

    self.manager = ToolsManager.getInstance({ name: self.name });
     const manager = self.manager;
      const env = { manager, control: self };

       //Add standard image tools
      if (self.selectioncontrol) manager.addTool("MoveTool", Tools.Selection.create({}, env), "MoveTool");
      if (self.zoomcontrol) manager.addTool("ZoomPanTool", Tools.Zoom.create({}, env), "ZoomPanTool");
      if (self.brightnesscontrol) manager.addTool("BrightnessTool", Tools.Brightness.create({}, env), "BrightnessTool");
      if (self.contrastcontrol) manager.addTool("ContrastTool", Tools.Contrast.create({}, env), "ContrastTool");
      if (self.saturationcontrol) manager.addTool("SaturationTool", Tools.Saturation.create({}, env), "SaturationTool");
      if (self.invertcontrol) manager.addTool("InvertTool", Tools.Invert.create({}, env), "InvertTool");
      if (self.rotatecontrol) manager.addTool("RotateTool", Tools.Rotate.create({}, env), "RotateTool");
    
      const activeTool = manager?.activeTool;

      if (activeTool) {
        if (eventType === "mousedown" && activeTool.onMouseDown) {
          activeTool.onMouseDown({ x, y, originalEvent: event.originalEvent });
        } else if (eventType === "mouseup" && activeTool.onMouseUp) {
          activeTool.onMouseUp({ x, y, originalEvent: event.originalEvent });
        } else if (eventType === "click" && activeTool.onClick) {
          activeTool.onClick({ x, y, originalEvent: event.originalEvent });
        } else if (eventType === "mousemove" && activeTool.onMouseMove) {
          activeTool.onMouseMove({ x, y, originalEvent: event.originalEvent });
        }
      }
      
    },//after attach
    getToolsManager() {
      return self.manager;
    },//actions

    getStage(){
      console.log("Someone called getStage")
      return <Stage>
        <div
        id="get stage placeholder for hugeimage">
        </div>
      </Stage>
    }

}//model
));


// Inject store into your view
const HtxHugeImage = inject("store")(SeadragonView);

// Register with the new tag name\
Registry.addTag("hugeimage", HugeImageModel, HtxHugeImage);
Registry.addObjectType(HugeImageModel);

//each tool normally adds themselves to the control type
//which seems dumb, its already imported, leave that to the control model to do
// Register all region types that work with HugeImage

//the lambda tests if this model should be available for that control

// 1. Brush Region - detects rle, touches, or maskDataURL
Registry.addRegionType(
  BrushRegionModel, 
  "hugeimage", 
  (value) => value.rle || value.touches || value.maskDataURL
);


// 2. Rectangle Region - no detector (always available)
Registry.addRegionType(RectRegionModel, "hugeimage");

// 3. Polygon Region - detects points array
Registry.addRegionType(PolygonRegionModel, "hugeimage", (value) => !!value.points);

// 4. Ellipse Region - no detector (always available)
Registry.addRegionType(EllipseRegionModel, "hugeimage");

// 5. KeyPoint Region - detects x, y, width but NOT height
Registry.addRegionType(
  KeyPointRegionModel,
  "hugeimage",
  (value) => "x" in value && "y" in value && "width" in value && !("height" in value)
);

export { HugeImageModel, HtxHugeImage };