import crypto from "crypto";
import { s3 } from "../config/s3.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import db from "../models/index.js";
import sequelize from "../config/database.js";
import { Op, Sequelize } from "sequelize";

const { Asset, AssetDocument, AssetRequest, AssetRequestItem, User, AssetRequestItemImage, SiteData, AssetReturnRequest, AssetReturnItem, AssetReturnImage } = db;
import { v4 as uuid } from "uuid";

import { requestDecisionTemplates } from "../utils/assetReqDecision.js";
// import { transporter } from "../config/mailer.js";
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
        const companyId = req.user.company_id;

        const {
            asset_name, asset_type, qty, units, make,
            remarks, asset_condition, asset_status
        } = req.body;

        const assetImageUrl = req.files?.asset_image
            ? await uploadDoc(req.files.asset_image[0], "asset-images")
            : null;

        const finalCondition = asset_condition ?? "WORKING";

        const asset = await Asset.create({
            asset_name,
            asset_type,
            qty,
            units,
            make,
            remarks,
            asset_condition: finalCondition,
            asset_status: finalCondition === "WORKING" ? null : asset_status,
            asset_image: assetImageUrl,
            company_id: companyId,
        });

        for (const field of ["warranty", "technical_data_sheet", "calibration_certificate"]) {
            if (req.files?.[field]) {
                const url = await uploadDoc(req.files[field][0]);
                await AssetDocument.create({
                    asset_id: asset.asset_id,
                    document_url: url,
                    doc_type: field,
                    company_id: companyId,
                });
            }
        }

        res.status(201).json({ message: "Asset created", data: asset });
    } catch (err) {
        next(err);
    }
};




//FETCH ASSETS
// export const getAssets = async (req, res, next) => {
//     try {
//         const companyId = req.user.company_id;

//         const assets = await Asset.findAll({
//             where: { company_id: companyId },
//             order: [["createdAt", "DESC"]],
//             include: [
//                 {
//                     model: AssetDocument,
//                     as: "documents",
//                     where: { company_id: companyId },
//                     required: false,
//                 },
//             ],
//         });

//         res.json(assets);
//     } catch (err) {
//         next(err);
//     }
// };

export const getAssets = async (req, res, next) => {
    try {
        const companyId = req.user.company_id;
        const assets = await Asset.findAll({
            where: { company_id: companyId },
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
                    where: { company_id: companyId },
                    attributes: ["id", "document_url", "createdAt"],
                    required: false,
                },
                {
                    model: AssetRequestItem,
                    as: "pendingItems",
                    where: { company_id: companyId },
                    attributes: [],
                    required: false,
                    include: [
                        {
                            model: AssetRequest,
                            attributes: [],
                            as: "request",
                            where: {
                                admin_approval: "PENDING",
                                company_id: companyId
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
        const companyId = req.user.company_id;
        const { id } = req.params;

        const asset = await Asset.findOne({
            where: { asset_id: id, company_id: companyId },
            include: [{ model: AssetDocument, as: "documents" }],
        });

        if (!asset) {
            return res.status(404).json({ message: "Asset not found" });
        }

        await AssetDocument.destroy({
            where: { asset_id: id, company_id: companyId },
        });

        await asset.destroy();

        res.json({ message: "Asset deleted", asset_id: id });
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
        const companyId = req.user.company_id;
        const assetId = req.params.id;

        console.log(assetId, 'assetId')

        const asset = await Asset.findOne({
            where: {
                asset_id: assetId,
                company_id: companyId,
            },
            include: [
                {
                    model: AssetDocument,
                    as: "documents",
                    where: { company_id: companyId },
                    required: false,
                },
            ],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!asset) {
            await t.rollback();
            return res.status(404).json({ message: "Asset not found" });
        }

        const {
            asset_name,
            asset_type,
            qty,
            units,
            make,
            remarks,
            asset_condition,
            asset_status,
        } = req.body;

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
                asset_image: asset.asset_image,
                asset_condition: finalCondition,
                asset_status:
                    finalCondition === "WORKING" ? null : asset_status ?? null,
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
                const oldDocs = asset.documents.filter(
                    d => d.doc_type === field
                );

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
                        company_id: companyId,
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
        const companyId = req.user.company_id;
        const { id } = req.params;

        const asset = await Asset.findOne({
            where: { asset_id: id, company_id: companyId },
            include: [
                {
                    model: AssetDocument,
                    as: "documents",
                    where: { company_id: companyId },
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

        const companyId = req.user.company_id;
        // 1️⃣ Create request
        const assetRequest = await AssetRequest.create(
            {
                req_user_id,
                admin_user_id,
                site_id,
                priority_level,
                request_remarks, allocated: 0,
                company_id: companyId,
            },
            { transaction }
        );

        // 2️⃣ Create request items

        const requestItems = items.map(item => ({
            req_id: assetRequest.req_id,
            asset_id: item.asset_id,
            requested_qty: item.requested_qty,
            spare_item: item.spare_item ?? false, // ✅ NEW
            company_id: companyId,
        }));


        await AssetRequestItem.bulkCreate(requestItems, { transaction });

        // After bulkCreate but BEFORE commit
        const fullRequest = await AssetRequest.findOne({
            where: { req_id: assetRequest.req_id },
            include: [
                {
                    model: User,
                    as: "requestedBy",   // ✅ match alias exactly
                    attributes: ["id", "fullName", "email", "mobile", "role"],
                },
                {
                    model: User,
                    as: "approvedBy",    // ✅ match alias exactly
                    attributes: ["id", "fullName", "email", "mobile", "role"],
                },
                {
                    model: SiteData,
                    as: "site",          // ✅ matches your alias
                },
                {
                    model: AssetRequestItem,
                    as: "items",
                },
            ],
            transaction,
        });

        // 3️⃣ Commit
        await transaction.commit();

        return res.status(201).json({
            message: "Asset request created successfully",
            data: fullRequest,
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
        const companyId = req.user.company_id;
        const adminId = req.user.id;

        const requests = await AssetRequest.findAll({
            where: {
                company_id: companyId,
                // admin_user_id: adminId, // enable if needed
            },
            order: [["requested_at", "DESC"]],
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "username"],
                },
                {
                    model: SiteData,
                    as: "site",
                    where: { company_id: companyId },
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
                    where: { company_id: companyId },
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            where: { company_id: companyId },
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
    const t = await sequelize.transaction();

    try {
        const companyId = req.user.company_id;
        const adminId = req.user.id;
        const { reqId } = req.params;
        const { decision, adminAdvice } = req.body;

        const request = await AssetRequest.findOne({
            where: {
                req_id: reqId,
                company_id: companyId,
            },
            include: [
                {
                    model: AssetRequestItem,
                    as: "items",
                    where: { company_id: companyId },
                },
                {
                    model: User,
                    as: "requestedBy",
                },
            ],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!request || request.admin_approval !== "PENDING") {
            throw new Error("Invalid or already processed request");
        }

        if (decision === "APPROVED") {
            for (const item of request.items) {
                const asset = await Asset.findOne({
                    where: {
                        asset_id: item.asset_id,
                        company_id: companyId,
                    },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

                if (!asset || asset.qty < item.requested_qty) {
                    throw new Error(
                        `Insufficient stock for ${asset?.asset_name ?? "Asset"}`
                    );
                }

                asset.qty -= item.requested_qty;
                await asset.save({ transaction: t });
            }
        }

        await request.update(
            {
                admin_approval: decision,
                admin_user_id: adminId,
                admin_advice: adminAdvice ?? null,
            },
            { transaction: t }
        );

        await t.commit();
        res.json({ success: true });
    } catch (err) {
        await t.rollback();
        res.status(400).json({ message: err.message });
    }
};


//FETCH ASSET REQUEST BY ID
export const getAssetRequestById = async (req, res) => {
    try {
        const companyId = req.user.company_id;
        const { reqId } = req.params;

        const request = await AssetRequest.findOne({
            where: {
                req_id: reqId,
                company_id: companyId,
            },
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["fullName"],
                },
                {
                    model: User,
                    as: "approvedBy",
                    attributes: ["fullName"],
                },
                {
                    model: SiteData,
                    as: "site",
                    where: { company_id: companyId },
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
                    where: { company_id: companyId },
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            where: { company_id: companyId },
                            attributes: [
                                "asset_id",
                                "asset_name",
                                "units",
                                "qty",
                                "asset_image",
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
        res.status(500).json({ message: "Failed to fetch request" });
    }
};



//MARK ASSET REQUEST AS ALLOCATED
// export const allocateAssetRequest = async (req, res) => {
//     const { reqId } = req.params;

//     const request = await AssetRequest.findByPk(reqId);

//     if (!request) {
//         return res.status(404).json({ message: "Request not found" });
//     }

//     if (request.admin_approval !== "APPROVED") {
//         return res
//             .status(400)
//             .json({ message: "Request must be approved first" });
//     }

//     if (request.allocated) {
//         return res
//             .status(400)
//             .json({ message: "Request already allocated" });
//     }

//     request.allocated = 1;
//     await request.save();

//     res.json({
//         success: true,
//         message: "Request allocated successfully",
//     });
// };

export const allocateAssetRequest = async (req, res) => {
    const { reqId } = req.params;
    const companyId = req.user.company_id;


    const transaction = await sequelize.transaction();

    try {
        // 1️⃣ Fetch request (company scoped)
        const request = await AssetRequest.findOne({
            where: {
                req_id: reqId,
                company_id: companyId,
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!request) {
            await transaction.rollback();
            return res.status(404).json({ message: "Request not found" });
        }

        if (request.admin_approval !== "APPROVED") {
            await transaction.rollback();
            return res.status(400).json({
                message: "Request must be approved first",
            });
        }

        // 2️⃣ Check allocated request for same site + same company
        const existingAllocatedRequest = await AssetRequest.findOne({
            where: {
                site_id: request.site_id,
                allocated: 1,
                company_id: companyId,
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (existingAllocatedRequest) {
            // 3️⃣ Merge items
            await AssetRequestItem.update(
                { req_id: existingAllocatedRequest.req_id },
                {
                    where: {
                        req_id: request.req_id,
                        company_id: companyId,
                    },
                    transaction,
                }
            );

            await AssetRequest.destroy({
                where: {
                    req_id: request.req_id,
                    company_id: companyId,
                },
                transaction,
            });

            await transaction.commit();

            return res.json({
                success: true,
                message: "Request items merged into existing allocated request",
                merged_into_req_id: existingAllocatedRequest.req_id,
            });
        }

        // 4️⃣ Allocate current request
        await request.update(
            { allocated: 1 },
            { transaction }
        );

        await transaction.commit();

        return res.json({
            success: true,
            message: "Request allocated successfully",
            req_id: request.req_id,
        });
    } catch (error) {
        await transaction.rollback();
        console.error("allocateAssetRequest error:", error);

        return res.status(500).json({
            message: "Failed to allocate request",
        });
    }
};



//FETCH ALLOCATED ASSET REQUESTS
export const getAllocatedAssetRequests = async (req, res, next) => {
    try {
        const companyId = req.user.company_id;

        const requests = await AssetRequest.findAll({
            where: {
                admin_approval: "APPROVED",
                allocated: 1,
                company_id: companyId,
            },
            order: [["requested_at", "DESC"]],
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "username"],
                },
                {
                    model: SiteData,
                    as: "site",
                    where: { company_id: companyId },
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
                    where: { company_id: companyId },
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            where: { company_id: companyId },
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
        const companyId = req.user.company_id;

        // console.log(`Fetching allocated request with ID ${reqId} for company ${companyId}`)

        const request = await AssetRequest.findOne({
            where: {
                req_id: reqId,
                admin_approval: "APPROVED",
                allocated: true,
                company_id: companyId,
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
                    where: { company_id: companyId },
                    // attributes: [
                    //     "site_id",
                    //     "bridge_no",
                    //     "location",
                    //     "site_division",
                    //     "site_last_date",
                    // ], 
                    required: false,
                },
                {
                    model: AssetRequestItem,
                    as: "items",
                    // where: { company_id: companyId }, required: false,
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            // where: { company_id: companyId },
                            attributes: [
                                "asset_id",
                                "asset_name",
                                "units",
                                "asset_type",
                                "asset_condition",
                                "asset_status",
                                "remarks",
                            ],
                        },
                        {
                            model: AssetRequestItemImage,
                            as: "images",
                            // where: { company_id: companyId },
                            where: {
                                [Op.or]: [
                                    { company_id: companyId },
                                    { company_id: null },
                                ],
                            },

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
                            // where: { company_id: companyId },
                            attributes: [
                                "return_id",
                                "request_item_id",
                                "status",
                                "return_type",
                                "receiver_remarks",
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
                                    // where: { company_id: companyId },
                                    attributes: [
                                        "id",
                                        "return_qty",
                                        "asset_id",
                                    ],
                                    include: [
                                        {
                                            model: AssetReturnImage,
                                            as: "images",
                                            // where: { company_id: companyId },
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

        // console.log("Fetched allocated request22:", request?.toJSON());

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
    try {
        const { siteId } = req.params;
        const { site_end_date } = req.body;
        const { company_id } = req.user;


        if (!site_end_date) {
            return res.status(400).json({ message: "site_end_date is required" });
        }

        const [updated] = await SiteData.update(
            { site_last_date: site_end_date },
            {
                where: {
                    site_id: siteId,
                    company_id, // 🔐 tenant isolation
                },
            }
        );

        if (!updated) {
            return res.status(404).json({
                message: "Asset request not found for this company",
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("UPDATE SITE END DATE ERROR:", err);
        res.status(500).json({ message: "Server error" });
    }
};



//RECORD ASSET USAGE
export const uploadUsageImage = async (req, res) => {
    try {
        const { request_item_id } = req.params;
        const { usage_qty, asset_condition } = req.body;
        const { company_id } = req.user;

        if (!req.file) {
            return res.status(400).json({ message: "Usage image is required" });
        }

        const item = await AssetRequestItem.findOne({
            where: {
                id: request_item_id,
                company_id, // 🔐
            },
            include: ["images"],
        });

        if (!item) {
            return res.status(404).json({
                message: "Asset request item not found for this company",
            });
        }

        const usedQty =
            item.images?.reduce((sum, img) => sum + Number(img.usage_qty), 0) || 0;

        if (usedQty + Number(usage_qty) > item.requested_qty) {
            return res.status(400).json({
                message: "Usage exceeds requested quantity",
            });
        }

        const image_url = await uploadDoc(req.file, "asset-usage");

        const record = await AssetRequestItemImage.create({
            request_item_id,
            image_url,
            usage_qty,
            asset_condition,
            uploaded_by: req.user.id,
            company_id, // 🔐 strongly recommended
        });

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
    try {
        const { reqId } = req.params;
        const { company_id } = req.user;

        const items = await AssetRequestItem.findAll({
            where: {
                req_id: reqId,
                company_id, // 🔐
            },
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
                ["id", "ASC"],
                [
                    { model: AssetRequestItemImage, as: "images" },
                    "uploaded_at",
                    "DESC",
                ],
            ],
        });

        res.json(items);
    } catch (err) {
        console.error("GET USAGE IMAGES ERROR:", err);
        res.status(500).json({ message: "Server error" });
    }
};




//Asset Request Item Usage - Status Update(REQUESTED)
export const requestSpareApproval = async (req, res) => {
    try {
        const { request_item_id, remarks } = req.body;
        const { company_id } = req.user;

        const [updated] = await AssetRequestItem.update(
            {
                spare_status: "REQUESTED",
                spare_remarks: remarks || null,
            },
            {
                where: {
                    id: request_item_id,
                    company_id, // 🔐
                },
            }
        );

        if (!updated) {
            return res.status(404).json({
                message: "Request item not found for this company",
            });
        }

        res.json({ message: "Spare approval requested" });
    } catch (err) {
        console.error("REQUEST SPARE APPROVAL ERROR:", err);
        res.status(500).json({ message: "Server error" });
    }
};



//Asset Request Item Usage - Status Update(APPROVE or REJECT)
export const approveSpareRequest = async (req, res) => {
    try {
        const { request_item_id } = req.params;
        const { decision } = req.body;
        const { role, company_id, id: user_id } = req.user;

        if (!["ADMIN", "INVENTORY_MANAGER"].includes(role)) {
            return res.status(403).json({ message: "Not authorized" });
        }

        if (!["APPROVED", "REJECTED"].includes(decision)) {
            return res.status(400).json({ message: "Invalid decision" });
        }

        const item = await AssetRequestItem.findOne({
            where: {
                id: request_item_id,
                company_id, // 🔐
            },
        });

        if (!item) {
            return res.status(404).json({
                message: "Request item not found for this company",
            });
        }

        if (item.spare_status !== "REQUESTED") {
            return res.status(400).json({
                message: "Spare request not in REQUESTED state",
            });
        }

        item.spare_status = decision;
        item.spare_approved_by = user_id;
        item.spare_approved_at = new Date();

        await item.save();

        res.json({
            message: `Spare request ${decision.toLowerCase()} successfully`,
            request_item_id,
            decision,
        });
    } catch (err) {
        console.error("APPROVE SPARE REQUEST ERROR:", err);
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
            asset_condition,
            receiver_remarks,
            received_by,
        } = req.body;

        const { id: userId, company_id } = req.user;

        const imageFiles = req.files?.length
            ? req.files
            : req.file
                ? [req.file]
                : [];

        // =====================================================
        // STEP 1: FETCH ORIGINAL REQUEST ITEM (🔐 company safe)
        // =====================================================
        const requestItem = await AssetRequestItem.findOne({
            where: {
                id: request_item_id,
                company_id,
            },
            attributes: ["requested_qty", "spare_item"],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!requestItem) {
            throw new Error("Invalid request item for this company");
        }

        // =====================================================
        // STEP 2: CALCULATE ALREADY RETURNED (🔐 scoped)
        // =====================================================
        const alreadyReturned =
            (await AssetReturnItem.sum("return_qty", {
                include: [
                    {
                        model: AssetReturnRequest,
                        as: "returnRequest",
                        where: {
                            request_item_id,
                            company_id,
                        },
                        attributes: [],
                    },
                ],
                transaction: t,
            })) || 0;

        const remainingReturnable =
            requestItem.requested_qty - alreadyReturned;

        if (return_qty > remainingReturnable) {
            throw new Error(
                `Only ${remainingReturnable} quantity left to return`
            );
        }

        // =====================================================
        // STEP 3: CREATE RETURN REQUEST (🔐 company bound)
        // =====================================================
        const returnReq = await AssetReturnRequest.create(
            {
                return_id: uuid(),
                request_item_id,
                from_site_id,
                to_site_id: to_site_id || null,
                return_type,
                initiated_by: received_by,
                status: "INITIATED",
                receiver_remarks: receiver_remarks || null,
                company_id,
            },
            { transaction: t }
        );

        const returnItem = await AssetReturnItem.create(
            {
                id: uuid(),
                return_id: returnReq.return_id,
                asset_id,
                return_qty,
                spare_check: requestItem.spare_item,
                company_id,
            },
            { transaction: t }
        );

        // =====================================================
        // STEP 4: IMAGE COUNT SAFETY
        // =====================================================
        if (imageFiles.length > return_qty) {
            throw new Error("Images cannot exceed return quantity");
        }

        // =====================================================
        // STEP 5: SAVE IMAGES (🔐)
        // =====================================================
        for (const file of imageFiles) {
            const imageUrl = await uploadDoc(file, "asset-return");

            await AssetReturnImage.create(
                {
                    id: uuid(),
                    return_item_id: returnItem.id,
                    image_url: imageUrl,
                    stage: "DISPATCH",
                    asset_condition,
                    uploaded_by: userId,
                    company_id,
                },
                { transaction: t }
            );
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
        console.error("initiateReturnRequest error:", e);
        res.status(500).json({ error: e.message });
    }
};



//REVIEW RETURN ITEMS
export const reviewReturnRequest = async (req, res) => {
    const { return_id, decision, inventory_remarks, approvedAdminId } = req.body;
    const { company_id } = req.user;

    const t = await sequelize.transaction();
    try {
        const request = await AssetReturnRequest.findOne({
            where: {
                return_id,
                company_id,
            },
            include: [
                {
                    model: AssetReturnItem,
                    as: "items",
                    where: { company_id },
                    include: [{ model: Asset, as: "asset" }],
                },
            ],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!request) {
            await t.rollback();
            return res
                .status(404)
                .json({ message: "Return request not found for this company" });
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
                    where: {
                        return_id,
                        company_id,
                    },
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

            // 🏢 RETURN TO OFFICE
            if (request.return_type === "RETURN_TO_OFFICE") {
                for (const item of request.items) {
                    await item.asset.increment("qty", {
                        by: item.return_qty,
                        transaction: t,
                    });
                }
            }

            // 🔁 TRANSFER TO ANOTHER SITE
            if (
                request.return_type === "TRANSFER_TO_SITE" &&
                request.to_site_id
            ) {
                let assetRequest = await AssetRequest.findOne({
                    where: {
                        site_id: request.to_site_id,
                        company_id,
                    },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

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
                            company_id,
                        },
                        { transaction: t }
                    );
                }

                const requestItems = request.items.map((item) => ({
                    req_id: assetRequest.req_id,
                    asset_id: item.asset_id,
                    requested_qty: item.return_qty,
                    spare_item: item.spare_check,
                    company_id,
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
        res.status(400).json({ message: "Invalid decision value" });
    } catch (error) {
        await t.rollback();
        console.error("reviewReturnRequest error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};



//Request Servicing
export const requestServicing = async (req, res) => {
    const {
        request_item_id,
        remarks,
        service_person_name,
        service_person_mobile,
        serviced_date,
    } = req.body;

    const { company_id } = req.user;

    const item = await AssetRequestItem.findOne({
        where: {
            id: request_item_id,
            company_id,
        },
    });

    if (!item) {
        return res
            .status(404)
            .json({ message: "Request item not found for this company" });
    }

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
    const { company_id } = req.user;

    const item = await AssetRequestItem.findOne({
        where: {
            id: request_item_id,
            company_id,
        },
    });

    if (!item) {
        return res
            .status(404)
            .json({ message: "Request item not found for this company" });
    }

    await item.update({
        servicing_status: decision,
        servicing_remarks: remarks,
        servicing_reviewed_at: new Date(),
    });

    res.json({ message: "Servicing decision recorded" });
};



//SERVICING OUTCOME
export const completeServicing = async (req, res) => {
    const { request_item_id, outcome } = req.body;
    const { company_id } = req.user;

    if (!["COMPLETED", "SCRAPPED"].includes(outcome)) {
        return res.status(400).json({ message: "Invalid servicing outcome" });
    }

    const item = await AssetRequestItem.findOne({
        where: {
            id: request_item_id,
            company_id,
        },
    });

    if (!item) {
        return res
            .status(404)
            .json({ message: "Item not found for this company" });
    }

    if (item.servicing_status !== "APPROVED") {
        return res.status(400).json({ message: "Item not in servicing" });
    }

    if (outcome === "COMPLETED") {
        await item.update({
            servicing_status: null,
            servicing_outcome: null,
            servicing_completed_at: null,
        });
    }

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
