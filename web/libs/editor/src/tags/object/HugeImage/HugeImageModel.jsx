// HugeImage.js - Simple implementation using existing ImageModel

import { inject } from "mobx-react";
import Registry from "../../../core/Registry";
import { ImageModel } from "../Image/Image"; // Import the existing model
import SeadragonView from "../../../components/SeaDragon/SeadragonView";

// Just use the existing ImageModel, but change the tag name and type
const HugeImageModel = ImageModel.named("HugeImageModel").props({
  type: "hugeimage", // Only change the type
});

// Inject store into your view
const HtxHugeImage = inject("store")(SeadragonView);

// Register with the new tag name
Registry.addTag("hugeimage", HugeImageModel, HtxHugeImage);
Registry.addObjectType(HugeImageModel);

export { HugeImageModel, HtxHugeImage };