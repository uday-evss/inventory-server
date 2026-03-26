import express from "express";
import {
  approveSpareRequest,
  requestSpareApproval,
  getUsageImages,
  uploadUsageImage,
  initiateReturnRequest,
  reviewReturnRequest,
  updateSiteEndDate,
  getAllocatedAssetRequestById,
  getAllocatedAssetRequests,
  createAsset,
  getAllocatedAssetRequestsByActiveSites,
  getAssets,
  deleteAsset,
  updateAsset,
  getAssetById,
  createAssetRequest,
  getRequestsForAdmin,
  markAssetsReceived,
  decideAssetRequest,
  getAssetRequestById,
  allocateAssetRequest,
  reviewServicing,
  requestServicing,
  completeServicing,
  deleteRequestItem,
  updateRequestItemQty,
  addRequestItem,
} from "../controllers/asset.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";
const router = express.Router();

router.post(
    "/create",
    authenticate,
    upload.fields([
        { name: "asset_image", maxCount: 1 },
        { name: "warranty", maxCount: 1 },
        { name: "technical_data_sheet", maxCount: 1 },
        { name: "calibration_certificate", maxCount: 1 },
    ]),
    createAsset
);
router.get("/fetchAll", authenticate, getAssets);
router.delete("/delete/:id", authenticate, deleteAsset);
router.put(
    "/:id",
    authenticate,
    upload.fields([
        { name: "asset_image", maxCount: 1 },
        { name: "warranty", maxCount: 1 },
        { name: "technical_data_sheet", maxCount: 1 },
        { name: "calibration_certificate", maxCount: 1 },
    ]),
    updateAsset
);
router.get("/:id", authenticate, getAssetById);
router.post("/asset-requests", authenticate, createAssetRequest);

router.get(
  "/asset-requests/allocated-records/inventory",
  authenticate,
  getAllocatedAssetRequestsByActiveSites,
);

router.get(
  "/asset-requests/allocated-records",
  authenticate,
  getAllocatedAssetRequests,
);

router.get(
    "/asset-requests/allocated-records/:reqId",
    authenticate,
    getAllocatedAssetRequestById
);


router.get("/asset-requests/:adminId", authenticate, getRequestsForAdmin);
router.post("/asset-requests/decision/:reqId", authenticate, decideAssetRequest);
router.get("/asset-requests/request/:reqId", authenticate, getAssetRequestById);



// DELETE ITEM
router.delete(
  "/asset-requests/item/:itemId",
  authenticate,
  deleteRequestItem,
);

// UPDATE ITEM QTY
router.put(
  "/asset-requests/item/:itemId",
  authenticate,
  updateRequestItemQty,
);

// ADD ITEM TO REQUEST
router.post(
  "/asset-requests/item",
  authenticate,
  addRequestItem
);



router.put(
    "/asset-requests/allocate/:reqId",
    authenticate,
    allocateAssetRequest
);

router.put(
  "/asset-requests/receive/:reqId",
  authenticate,
  markAssetsReceived,
);

router.put("/asset-requests/site-end-date/:siteId", authenticate, updateSiteEndDate);
router.post(
    "/asset-usage/:request_item_id",
    authenticate,
    upload.single("image"),
    uploadUsageImage
);

router.get("/usage-images/:reqId", authenticate, getUsageImages);

router.post('/request-spare', authenticate, requestSpareApproval)

router.put("/spare-request/:request_item_id", authenticate, approveSpareRequest);

router.post(
    "/return/initiate",
    authenticate,
    upload.array("images"),
    initiateReturnRequest
);


router.post("/return/review", authenticate, reviewReturnRequest);
router.post("/servicing-request", authenticate, requestServicing);
router.post("/servicing-review", authenticate, reviewServicing);
router.post("/servicing-complete", authenticate, completeServicing);





export default router;
