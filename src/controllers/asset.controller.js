import crypto from "crypto";
import { s3 } from "../config/s3.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import db from "../models/index.js";
import sequelize from "../config/database.js";
import { Op, Sequelize } from "sequelize";

const { Asset, AssetDocument, AssetRequest, AssetRequestItem, User, AssetRequestItemImage, SiteData, AssetReturnRequest, AssetReturnItem, AssetReturnImage } = db;
import { v4 as uuid } from "uuid";

import { requestDecisionTemplates } from "../utils/assetReqDecision.js";
import { transporter } from "../config/mailer.js";
import { sendWhatsappMessage } from "../utils/sendWhatsapp.js";

const uploadDoc = async (file, folder = "assets") => {
    const key = `${folder}/${crypto.randomUUID()}.${file.originalname.split(".").pop()}`;

    await s3.send(
        new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        })
    );

    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};


//CREATE ASSET
export const createAsset = async (req, res, next) => {
    try {
        const {
            asset_name,
            asset_type,
            qty,
            units,
            make,
            remarks,
            asset_condition, // ✅ NEW
            asset_status,    // ✅ NEW (can be null)
        } = req.body;

        let assetImageUrl = null;
        if (req.files?.asset_image) {
            assetImageUrl = await uploadDoc(
                req.files.asset_image[0],
                "asset-images"
            );
        }
        const finalCondition = asset_condition ?? "WORKING";


        const asset = await Asset.create({
            asset_name,
            asset_type,
            qty,
            units,
            make,
            remarks,
            asset_condition: asset_condition ?? "WORKING",
            asset_status: finalCondition === "WORKING" ? null : asset_status ?? null,
            asset_image: assetImageUrl,
        });

        // documents logic unchanged
        for (const field of [
            "warranty",
            "technical_data_sheet",
            "calibration_certificate",
        ]) {
            if (req.files?.[field]) {
                const url = await uploadDoc(req.files[field][0]);
                await AssetDocument.create({
                    asset_id: asset.asset_id,
                    document_url: url,
                    doc_type: field,
                });
            }
        }

        res.status(201).json({ message: "Asset created", data: asset });
    } catch (err) {
        next(err);
    }
};



//FETCH ASSETS
export const getAssets = async (req, res, next) => {
    try {
        const assets = await Asset.findAll({
            order: [["createdAt", "DESC"]],
            attributes: {
                include: [
                    // 🔢 SUM of pending requested qty
                    [
                        Sequelize.fn(
                            "COALESCE",
                            Sequelize.fn("SUM", Sequelize.col("pendingItems.requested_qty")),
                            0
                        ),
                        "pending_requested_qty",
                    ],
                ],
            },
            include: [
                {
                    model: AssetDocument,
                    as: "documents",
                    attributes: ["id", "document_url", "createdAt"],
                    required: false,
                },
                {
                    model: AssetRequestItem,
                    as: "pendingItems",
                    attributes: [],
                    required: false,
                    include: [
                        {
                            model: AssetRequest,
                            attributes: [],
                            as: "request",
                            where: {
                                admin_approval: "PENDING",
                            },
                        },
                    ],
                },
            ],
            group: ["Asset.asset_id", "documents.id"],
            subQuery: false,
        });

        // 🧠 Post-process for UX-friendly response
        const response = assets.map((asset) => {
            const assetJson = asset.toJSON();

            const pendingQty = Number(assetJson.pending_requested_qty || 0);
            const availableQty = assetJson.qty - pendingQty;
            // console.log(assetJson.qty, pendingQty, availableQty);

            return {
                ...assetJson,
                pending_requested_qty: pendingQty,
                available_qty: availableQty,
                availability_message:
                    pendingQty > 0
                        ? `Currently ${availableQty} ${assetJson.units} available. ${pendingQty} ${assetJson.units} are reserved in pending requests.`
                        : `All ${availableQty} ${assetJson.units} are available`,
            };
        });

        res.json(response);
    } catch (err) {
        next(err);
    }
};

/* helper: extract S3 key from full URL */
const getS3KeyFromUrl = (url) => {
    return url.split(".amazonaws.com/")[1];
};

// DELETE ASSET
export const deleteAsset = async (req, res, next) => {
    try {
        const { id } = req.params;

        const asset = await Asset.findByPk(id, {
            include: [{ model: AssetDocument, as: "documents" }],
        });

        if (!asset) {
            return res.status(404).json({ message: "Asset not found" });
        }

        /* ===== DELETE ASSET IMAGE FROM S3 ===== */
        if (asset.asset_image) {
            const key = getS3KeyFromUrl(asset.asset_image);
            await s3.send(
                new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                })
            );
        }

        /* ===== DELETE DOCUMENT FILES FROM S3 ===== */
        for (const doc of asset.documents) {
            const key = getS3KeyFromUrl(doc.document_url);
            await s3.send(
                new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                })
            );
        }

        /* ===== DELETE DB RECORDS ===== */
        await AssetDocument.destroy({
            where: { asset_id: id },
        });

        await asset.destroy();

        res.json({
            message: "Asset deleted successfully",
            asset_id: id,
        });
    } catch (err) {
        next(err);
    }
};

// DELETE FROM S3
const deleteFromS3 = async (url) => {
    if (!url) return;

    const key = url.split(".amazonaws.com/")[1];

    await s3.send(
        new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
        })
    );
};

// UPDATE ASSET
export const updateAsset = async (req, res, next) => {
    const t = await db.sequelize.transaction();

    try {
        const asset = await Asset.findByPk(req.params.id, {
            include: [{ model: AssetDocument, as: "documents" }],
            transaction: t,
        });

        if (!asset) {
            await t.rollback();
            return res.status(404).json({ message: "Asset not found" });
        }

        const { asset_name, asset_type, qty, units, make, remarks, asset_condition,
            asset_status, } = req.body;
        const finalCondition = asset_condition ?? "WORKING";

        /* ================= ASSET IMAGE ================= */
        if (req.files?.asset_image) {
            if (asset.asset_image) {
                await deleteFromS3(asset.asset_image);
            }

            const newImage = await uploadDoc(
                req.files.asset_image[0],
                "asset-images"
            );

            asset.asset_image = newImage;
        }

        /* ================= BASIC UPDATE ================= */
        await asset.update(
            {
                asset_name,
                asset_type,
                qty,
                units,
                make,
                remarks,
                asset_image: asset.asset_image, asset_condition,
                asset_status: finalCondition === "WORKING" ? null : asset_status ?? null,
            },
            { transaction: t }
        );

        /* ================= DOCUMENTS ================= */
        for (const field of [
            "warranty",
            "technical_data_sheet",
            "calibration_certificate",
        ]) {
            if (req.files?.[field]) {
                const oldDocs = asset.documents.filter(d => d.doc_type === field);

                for (const doc of oldDocs) {
                    await deleteFromS3(doc.document_url);
                    await doc.destroy({ transaction: t });
                }

                const url = await uploadDoc(req.files[field][0]);

                await AssetDocument.create(
                    {
                        asset_id: asset.asset_id,
                        document_url: url,
                        doc_type: field,
                    },
                    { transaction: t }
                );
            }
        }


        await t.commit();
        res.json({ message: "Asset updated", data: asset });
    } catch (err) {
        await t.rollback();
        next(err);
    }
};


// FETCH SINGLE ASSET BY ID
export const getAssetById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const asset = await Asset.findByPk(id, {
            include: [
                {
                    model: AssetDocument,
                    as: "documents",
                    attributes: ["id", "document_url", "createdAt"],
                    required: false,
                },
            ],
        });

        if (!asset) {
            return res.status(404).json({ message: "Asset not found" });
        }

        res.json(asset);
    } catch (err) {
        next(err);
    }
};


//CREATING ASSET REQUEST
export const createAssetRequest = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const {
            req_user_id,
            admin_user_id,
            site_id,
            priority_level,
            request_remarks,
            items,
        } = req.body;

        // 1️⃣ Create request
        const assetRequest = await AssetRequest.create(
            {
                req_user_id,
                admin_user_id,
                site_id,
                priority_level,
                request_remarks, allocated: 0
            },
            { transaction }
        );

        // 2️⃣ Create request items

        const requestItems = items.map(item => ({
            req_id: assetRequest.req_id,
            asset_id: item.asset_id,
            requested_qty: item.requested_qty,
            spare_item: item.spare_item ?? false, // ✅ NEW
        }));


        await AssetRequestItem.bulkCreate(requestItems, { transaction });

        // 3️⃣ Commit
        await transaction.commit();

        return res.status(201).json({
            message: "Asset request created successfully",
            data: assetRequest,
        });
    } catch (error) {
        await transaction.rollback();
        console.error(error);
        return res.status(500).json({
            message: "Failed to create asset request",
        });
    }
};

// export const createAssetRequest = async (req, res) => {
//     const transaction = await sequelize.transaction();

//     try {
//         const {
//             req_user_id,
//             admin_user_id,
//             site_id,
//             priority_level,
//             request_remarks,
//             items,
//         } = req.body;

//         // 1️⃣ Check if AssetRequest already exists for this site
//         let assetRequest = await AssetRequest.findOne({
//             where: { site_id },
//             transaction,
//             lock: transaction.LOCK.UPDATE,
//         });

//         // 2️⃣ If not exists → create new AssetRequest
//         if (!assetRequest) {
//             assetRequest = await AssetRequest.create(
//                 {
//                     req_user_id,
//                     admin_user_id,
//                     site_id,
//                     priority_level,
//                     request_remarks,
//                     allocated: 0,
//                 },
//                 { transaction }
//             );
//         }

//         // 3️⃣ Prepare request items using resolved req_id
//         const requestItems = items.map(item => ({
//             req_id: assetRequest.req_id,
//             asset_id: item.asset_id,
//             requested_qty: item.requested_qty,
//             spare_item: item.spare_item ?? false,
//         }));

//         // 4️⃣ Create request items
//         await AssetRequestItem.bulkCreate(requestItems, {
//             transaction,
//         });

//         // 5️⃣ Commit
//         await transaction.commit();

//         return res.status(201).json({
//             message: "Asset request processed successfully",
//             data: assetRequest,
//         });
//     } catch (error) {
//         await transaction.rollback();
//         console.error("createAssetRequest error:", error);

//         return res.status(500).json({
//             message: "Failed to create asset request",
//         });
//     }
// };


//GET ALL ASSET REQUESTS
export const getRequestsForAdmin = async (req, res, next) => {
    try {
        const { adminId } = req.params;

        const requests = await AssetRequest.findAll({
            // ✅ Uncomment if admin should see only their requests
            // where: { admin_user_id: adminId },

            order: [["requested_at", "DESC"]],

            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "username"],
                },

                // ✅ ADD THIS BLOCK — SITE DATA
                {
                    model: SiteData,
                    as: "site",
                    attributes: [
                        "site_id",
                        "bridge_no",
                        "location",
                        "site_division",
                        "site_last_date",
                    ],
                },

                {
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            attributes: ["asset_id", "asset_name", "units"],
                        },
                    ],
                },
            ],
        });

        res.json(requests);
    } catch (err) {
        next(err);
    }
};



//UPDATE ASSET REQUEST STATUS BY ADMIN
export const decideAssetRequest = async (req, res) => {
    const { reqId } = req.params;
    const { decision, adminId, adminAdvice } = req.body;

    const t = await sequelize.transaction();

    try {
        const request = await AssetRequest.findByPk(reqId, {
            include: [
                { model: AssetRequestItem, as: "items" },
                { model: User, as: "requestedBy" },
            ],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!request || request.admin_approval !== "PENDING") {
            throw new Error("Invalid or already processed request");
        }

        if (decision === "APPROVED") {
            for (const item of request.items) {
                const asset = await Asset.findByPk(item.asset_id, {
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

                if (asset.qty < item.requested_qty) {
                    throw new Error(
                        `Insufficient stock for ${asset.asset_name}`
                    );
                }

                asset.qty -= item.requested_qty;
                await asset.save({ transaction: t });
            }
        }

        request.admin_approval = decision;
        request.admin_user_id = adminId;
        request.admin_advice = adminAdvice || null;

        await request.save({ transaction: t });
        await t.commit();

        /* ================= SEND NOTIFICATIONS ================= */

        const template = requestDecisionTemplates({
            decision,
            siteName: request.site_name,
            requesterName: request.requestedBy.fullName,
        });

        // Email
        // await transporter.sendMail({
        //     from: `"KDM Engineers" <${process.env.MAIL_USER}>`,
        //     to: request.requestedBy.email,
        //     subject: template.subject,
        //     text: template.message,
        // });

        // WhatsApp
        // await sendWhatsappMessage({
        //     to: request.requestedBy.mobile,
        //     message: template.message,
        // });

        res.json({ success: true });
    } catch (err) {
        await t.rollback();
        console.error(err);
        res.status(400).json({ message: err.message });
    }
};

//FETCH ASSET REQUEST BY ID
export const getAssetRequestById = async (req, res) => {
    try {
        const { reqId } = req.params;

        const request = await AssetRequest.findOne({
            where: { req_id: reqId },
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["fullName",],
                },
                {
                    model: User,
                    as: "approvedBy",
                    attributes: ["fullName"],
                },


                {
                    model: SiteData,
                    as: "site",
                    attributes: [
                        "site_id",
                        "bridge_no",
                        "location",
                        "site_division",
                        "site_last_date"
                    ],
                },

                {
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            attributes: [
                                "asset_id",
                                "asset_name",
                                "units",
                                "qty", 'asset_image'
                            ],
                        },
                    ],
                },
            ],
        });

        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }

        res.json(request);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch request" });
    }
};


//MARK ASSET REQUEST AS ALLOCATED
export const allocateAssetRequest = async (req, res) => {
    const { reqId } = req.params;

    const request = await AssetRequest.findByPk(reqId);

    if (!request) {
        return res.status(404).json({ message: "Request not found" });
    }

    if (request.admin_approval !== "APPROVED") {
        return res
            .status(400)
            .json({ message: "Request must be approved first" });
    }

    if (request.allocated) {
        return res
            .status(400)
            .json({ message: "Request already allocated" });
    }

    request.allocated = 1;
    await request.save();

    res.json({
        success: true,
        message: "Request allocated successfully",
    });
};

//FETCH ALLOCATED ASSET REQUESTS
export const getAllocatedAssetRequests = async (req, res, next) => {
    try {
        const requests = await AssetRequest.findAll({
            where: {
                admin_approval: "APPROVED",
                allocated: 1,
            },
            order: [["requested_at", "DESC"]],
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "username"],
                },


                // ✅ ADD SITE JOIN
                {
                    model: SiteData,
                    as: "site",
                    attributes: [
                        "site_id",
                        "bridge_no",
                        "location",
                        "site_division",
                        "site_last_date",
                    ],
                },


                {
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            attributes: ["asset_id", "asset_name", "units"],
                        },
                    ],
                },
            ],
        });

        res.json(requests);
    } catch (err) {
        next(err);
    }
};

//FETCHING ALLOCATED ASSET REQ BY ID
export const getAllocatedAssetRequestById = async (req, res, next) => {
    try {
        const { reqId } = req.params;

        const request = await AssetRequest.findOne({
            where: {
                req_id: reqId,
                admin_approval: "APPROVED",
                allocated: true,
            },
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "username"],
                },
                {
                    model: User,
                    as: "approvedBy",
                    attributes: ["id", "fullName"],
                },
                {
                    model: SiteData,
                    as: "site",
                    attributes: [
                        "site_id",
                        "bridge_no",
                        "location",
                        "site_division",
                        "site_last_date",
                    ],
                },
                {
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            attributes: [
                                "asset_id",
                                "asset_name",
                                "units",
                                "asset_type", "asset_condition", 'asset_status', 'remarks'
                            ],
                        },
                        {
                            model: AssetRequestItemImage,
                            as: "images",
                            attributes: [
                                "id",
                                "image_url",
                                "usage_qty",
                                "asset_condition",
                                "uploaded_at",
                            ],
                            separate: true,
                            order: [["uploaded_at", "DESC"]],
                        },
                        {
                            model: AssetReturnRequest,
                            as: "returnRequests",
                            attributes: [
                                "return_id",
                                "request_item_id",
                                "status",
                                "return_type", 'receiver_remarks'
                            ],
                            include: [
                                {
                                    model: SiteData,
                                    as: "fromSite",
                                    attributes: [
                                        "site_id",
                                        "bridge_no",
                                        "location",
                                    ],
                                },
                                {
                                    model: SiteData,
                                    as: "toSite",
                                    attributes: [
                                        "site_id",
                                        "bridge_no",
                                        "location",
                                    ],
                                },
                                {
                                    model: AssetReturnItem,
                                    as: "items",
                                    attributes: [
                                        "id",
                                        "return_qty",
                                        "asset_id",
                                    ],
                                    include: [
                                        {
                                            model: AssetReturnImage,
                                            as: "images", // ✅ THIS IS THE KEY
                                            attributes: [
                                                "id",
                                                "image_url",
                                                "stage",
                                                "asset_condition",
                                                "uploaded_at",
                                            ],
                                        },
                                        {
                                            model: Asset,
                                            as: "asset",
                                            attributes: [
                                                "asset_id",
                                                "asset_name",
                                                "units",
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        if (!request) {
            return res.status(404).json({
                message: "Allocated request not found",
            });
        }

        res.json(request);
    } catch (err) {
        next(err);
    }
};




//UPDATE SITE END DATE
export const updateSiteEndDate = async (req, res) => {
    const { reqId } = req.params;
    const { site_end_date } = req.body;

    await AssetRequest.update(
        { site_due_date: site_end_date },
        { where: { req_id: reqId } }
    );

    res.json({ success: true });
};


//RECORD ASSET USAGE
export const uploadUsageImage = async (req, res) => {
    // console.log('triggered', req.params, req.body)
    try {
        const { request_item_id } = req.params;
        const { usage_qty, asset_condition } = req.body;

        if (!req.file) {
            return res.status(400).json({
                message: "Usage image is required",
            });
        }

        const item = await AssetRequestItem.findByPk(
            request_item_id,
            { include: ["images"] }
        );

        if (!item) {
            return res.status(404).json({
                message: "Asset request item not found",
            });
        }

        const usedQty =
            item.images?.reduce(
                (s, i) => s + i.usage_qty,
                0
            ) || 0;

        if (usedQty + Number(usage_qty) > item.requested_qty) {
            return res.status(400).json({
                message: "Usage exceeds requested quantity",
            });
        }

        const image_url = await uploadDoc(
            req.file,
            "asset-usage"
        );

        const record =
            await AssetRequestItemImage.create({
                request_item_id,
                image_url,
                usage_qty,
                asset_condition,
                uploaded_by: req.user.id,
            });

        // console.log(record, 'rec567')

        res.json(record);
    } catch (err) {
        console.error("UPLOAD USAGE ERROR:", err);
        res.status(500).json({
            message: "Failed to record asset usage",
        });
    }
};


// FETCHING ASSET REQUEST ITEM IMAGE RECORDS
export const getUsageImages = async (req, res) => {
    const { reqId } = req.params;

    try {
        const items = await AssetRequestItem.findAll({
            where: { req_id: reqId },

            attributes: ["id", "asset_id", "requested_qty"],

            include: [
                {
                    model: AssetRequestItemImage,
                    as: "images",
                    attributes: [
                        "id",
                        "image_url",
                        "usage_qty",
                        "asset_condition",
                        "uploaded_at",
                    ],
                },
            ],

            order: [
                ["id", "ASC"], // item order
                [{ model: AssetRequestItemImage, as: "images" }, "uploaded_at", "DESC"], // latest images first
            ],
        });

        res.json(items);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};



//Asset Request Item Usage - Status Update(REQUESTED)
export const requestSpareApproval = async (req, res) => {
    const { request_item_id, remarks } = req.body;

    await AssetRequestItem.update(
        {
            spare_status: "REQUESTED",
            spare_remarks: remarks || null,
        },
        { where: { id: request_item_id } }
    );

    res.json({ message: "Spare approval requested" });
};


//Asset Request Item Usage - Status Update(APPROVE or REJECT)
export const approveSpareRequest = async (req, res) => {
    try {
        const { request_item_id } = req.params;
        const { decision } = req.body;
        const user = req.user; // from JWT middleware

        // 🔒 Only admin / inventory roles
        if (!["ADMIN", "INVENTORY_MANAGER"].includes(user.role)) {
            return res.status(403).json({ message: "Not authorized" });
        }

        const item = await AssetRequestItem.findByPk(request_item_id);

        if (!item) {
            return res.status(404).json({ message: "Request item not found" });
        }

        if (item.spare_status !== "REQUESTED") {
            return res.status(400).json({
                message: "Spare request not in REQUESTED state",
            });
        }

        item.spare_status = decision; // APPROVED or REJECTED
        await item.save();

        res.json({
            message: `Spare request ${decision.toLowerCase()} successfully`,
            request_item_id,
            decision,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
};



//RETURN INITIATION
export const initiateReturnRequest = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const {
            request_item_id,
            return_type,
            from_site_id,
            to_site_id,
            asset_id,
            return_qty,
            asset_condition, receiver_remarks, received_by
        } = req.body;

        // console.log(received_by, 'received_by78')

        const imageFiles = req.files?.length ? req.files : req.file ? [req.file] : [];
        const userId = req.user.id;

        // =====================================================
        // STEP 1: FETCH ORIGINAL REQUEST ITEM
        // =====================================================
        const requestItem = await AssetRequestItem.findByPk(request_item_id, {
            attributes: ["requested_qty", "spare_item"],
            transaction: t,
        });

        // console.log(requestItem, 'requestItem786')

        if (!requestItem) throw new Error("Invalid request item");

        // =====================================================
        // STEP 2: CALCULATE ALREADY RETURNED
        // =====================================================
        const alreadyReturned =
            (await AssetReturnItem.sum("return_qty", {
                include: [
                    {
                        model: AssetReturnRequest,
                        as: "returnRequest",
                        where: { request_item_id },
                        attributes: [],
                    },
                ],
                transaction: t,
            })) || 0;

        const remainingReturnable = requestItem.requested_qty - alreadyReturned;

        if (return_qty > remainingReturnable) {
            throw new Error(`Only ${remainingReturnable} quantity left to return`);
        }

        // =====================================================
        // STEP 3: CREATE RETURN REQUEST
        // =====================================================
        const returnReq = await AssetReturnRequest.create({
            return_id: uuid(),
            request_item_id,
            from_site_id,
            to_site_id: to_site_id || null,
            return_type,
            initiated_by: received_by,
            status: "INITIATED",
            receiver_remarks: receiver_remarks || null,
        }, { transaction: t });

        const returnItem = await AssetReturnItem.create({
            id: uuid(),
            return_id: returnReq.return_id,
            asset_id,
            return_qty, spare_check: requestItem.spare_item
        }, { transaction: t });

        // =====================================================
        // STEP 4: IMAGE COUNT SAFETY
        // =====================================================
        if (imageFiles.length > return_qty) {
            throw new Error("Images cannot exceed return quantity");
        }

        // =====================================================
        // STEP 5: SAVE IMAGES
        // =====================================================
        for (const file of imageFiles) {
            const imageUrl = await uploadDoc(file, "asset-return");

            await AssetReturnImage.create({
                id: uuid(),
                return_item_id: returnItem.id,
                image_url: imageUrl,
                stage: "DISPATCH",
                asset_condition,
                uploaded_by: userId,
            }, { transaction: t });
        }

        await t.commit();

        res.json({
            message: "Return initiated",
            return_summary: {
                request_item_id,
                requested_qty: requestItem.requested_qty,
                returned_qty: alreadyReturned + Number(return_qty),
            },
        });

    } catch (e) {
        await t.rollback();
        res.status(500).json({ error: e.message });
    }
};


//REVIEW RETURN ITEMS
export const reviewReturnRequest = async (req, res) => {
    const { return_id, decision, inventory_remarks, approvedAdminId } = req.body;

    const t = await sequelize.transaction();



    try {
        const request = await AssetReturnRequest.findOne({
            where: { return_id },
            include: [
                {
                    model: AssetReturnItem,
                    as: "items",
                    include: [{ model: Asset, as: "asset" }],
                },
            ],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!request) {
            await t.rollback();
            return res.status(404).json({ message: "Return request not found" });
        }

        // 🚫 REJECT FLOW
        if (decision === "REJECTED") {
            await request.update(
                {
                    status: "REJECTED",
                    inventory_remarks,
                },
                { transaction: t }
            );

            await AssetReturnItem.update(
                { return_qty: 0 },
                {
                    where: { return_id },
                    transaction: t,
                }
            );

            await t.commit();
            return res.json({ message: "Return request rejected" });
        }

        // ✅ APPROVAL FLOW
        if (decision === "APPROVED") {
            await request.update(
                {
                    status: "APPROVED",
                    inventory_remarks,
                },
                { transaction: t }
            );

            // ============================================
            // 🏢 CASE 1: RETURN TO OFFICE
            // ============================================
            if (request.return_type === "RETURN_TO_OFFICE") {
                for (const item of request.items) {
                    await item.asset.increment("qty", {
                        by: item.return_qty,
                        transaction: t,
                    });
                }
            }

            // ============================================
            // 🔁 CASE 2: TRANSFER TO ANOTHER SITE
            // ============================================
            if (
                request.return_type === "TRANSFER_TO_SITE" &&
                request.to_site_id
            ) {
                // 1️⃣ Check if AssetRequest already exists for this return
                let assetRequest = await AssetRequest.findOne({
                    where: { site_id: request.to_site_id },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

                // 2️⃣ If not exists → create
                if (!assetRequest) {
                    assetRequest = await AssetRequest.create(
                        {
                            req_user_id: request.initiated_by,
                            admin_user_id: approvedAdminId,
                            admin_approval: "APPROVED",
                            req_nature: "TRANSFERRED",
                            site_id: request.to_site_id,
                            priority_level: "MEDIUM",
                            request_remarks: `Auto-created from asset transfer (Return ID: ${request.return_id})`,
                            allocated: 1,
                            return_identity: request.return_id,
                        },
                        { transaction: t }
                    );
                }

                // console.log(request.items, 'request.items')

                // 3️⃣ Create request items using resolved req_id
                const requestItems = request.items.map((item) => ({
                    req_id: assetRequest.req_id,
                    asset_id: item.asset_id,
                    requested_qty: item.return_qty,
                    spare_item: item.spare_check,
                }));

                await AssetRequestItem.bulkCreate(requestItems, {
                    transaction: t,
                });

            }

            await t.commit();
            return res.json({
                message: "Return approved and processed successfully",
            });
        }

        await t.rollback();
        return res.status(400).json({ message: "Invalid decision value" });
    } catch (error) {
        await t.rollback();
        console.error("reviewReturnRequest error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};


//Request Servicing
export const requestServicing = async (req, res) => {
    // console.log('trigerred')
    const { request_item_id, remarks,
        service_person_name,
        service_person_mobile,
        serviced_date,
    } = req.body;
    // console.log(
    //     "DEBUG servicing_remarks:",
    //     remarks,
    //     typeof remarks,
    //     JSON.stringify(remarks)
    // );
    const item = await AssetRequestItem.findByPk(request_item_id);
    if (!item) return res.status(404).json({ message: "Request item not found" });

    await item.update({
        servicing_status: "PENDING",
        servicing_remarks: remarks?.trim() || null,
        servicing_requested_at: new Date(),

        service_person_name: service_person_name || null,
        service_person_mobile: service_person_mobile || null,
        servicing_completed_at: serviced_date || null,
    });

    res.json({ message: "Servicing request submitted" });
};


//Review Servicing
export const reviewServicing = async (req, res) => {
    const { request_item_id, decision, remarks } = req.body;

    const item = await AssetRequestItem.findByPk(request_item_id);
    if (!item) return res.status(404).json({ message: "Request item not found" });

    await item.update({
        servicing_status: decision,
        servicing_remarks: remarks,
        servicing_reviewed_at: new Date(),
    });

    // Only if approved, change asset physical condition
    // if (decision === "APPROVED") {
    //     await Asset.update(
    //         { asset_condition: "SERVICING" },
    //         { where: { asset_id: item.asset_id } }
    //     );
    // }

    res.json({ message: "Servicing decision recorded" });
};


//SERVICING OUTCOME
export const completeServicing = async (req, res) => {
    const { request_item_id, outcome } = req.body;

    if (!["COMPLETED", "SCRAPPED"].includes(outcome)) {
        return res.status(400).json({ message: "Invalid servicing outcome" });
    }

    const item = await AssetRequestItem.findByPk(request_item_id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    if (item.servicing_status !== "APPROVED") {
        return res.status(400).json({ message: "Item not in servicing" });
    }

    // 🔹 CASE 1: Repair finished → Reset for next servicing cycle
    if (outcome === "COMPLETED") {
        await item.update({
            servicing_status: null,
            servicing_outcome: null,
            servicing_completed_at: null,
        });
    }

    // 🔹 CASE 2: Asset scrapped → Permanently dead at request-item level
    if (outcome === "SCRAPPED") {
        await item.update({
            servicing_outcome: "SCRAPPED",
            servicing_completed_at: new Date(),
        });
    }

    res.json({ message: "Servicing cycle closed" });
};





// export const markAsDispatched = async (req, res) => {
//     const { return_id } = req.body;

//     await AssetReturnRequest.update(
//         { status: "DISPATCHED" },
//         { where: { return_id } }
//     );

//     res.json({ message: "Dispatched" });
// };


// export const acknowledgeReceipt = async (req, res) => {
//     const { return_id, remarks } = req.body;

//     await AssetReturnRequest.update(
//         {
//             status: "RECEIVED",
//             receiver_remarks: remarks,
//         },
//         { where: { return_id } }
//     );

//     res.json({ message: "Received" });
// };
