import crypto from "crypto";
import { s3 } from "../config/s3.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import db from "../models/index.js";
import sequelize from "../config/database.js";
import { Op, Sequelize } from "sequelize";
import { sendGraphMail } from "../config/mailer.js";

const { Asset, AssetDocument, AssetRequest, AssetRequestItem, User, AssetRequestItemImage, SiteData, AssetReturnRequest, AssetReturnItem, AssetReturnImage, AssetRequestHistory,AssetRequestItemHistory } = db;
import { v4 as uuid } from "uuid";

import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

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
// let availabilityMessage='';
// if (availableQty < 0) {
//     availabilityMessage = `Have to send ${Math.abs(availableQty)} ${assetJson.units} to the sites`;
// } else if (pendingQty > 0) {
//     availabilityMessage = `Currently ${availableQty} ${assetJson.units} available. ${pendingQty} ${assetJson.units} are reserved in pending requests.`;
// } else {
//     availabilityMessage = `All ${availableQty} ${assetJson.units} are available`;
// }
            return {
                ...assetJson,
                pending_requested_qty: pendingQty,
                available_qty: availableQty,
                // availability_message:
                //     pendingQty > 0
                //         ? `Currently ${availableQty} ${assetJson.units} available. ${pendingQty} ${assetJson.units} are reserved in pending requests.`
                //         : `All ${availableQty} ${assetJson.units} are available`,

// availability_message:availabilityMessage

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

        // console.log(assetId, 'assetId')

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
            items,  asset_origin,
  origin_site_id
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
                company_id: companyId,  asset_origin,
  origin_site_id
            },
            { transaction }
        );

        // 2️⃣ Create request items

        // const requestItems = items.map(item => ({
        //     req_id: assetRequest.req_id,
        //     asset_id: item.asset_id,
        //     requested_qty: item.requested_qty,
        //     spare_item: item.spare_item ?? false, // ✅ NEW
        //     company_id: companyId,
        // }));

        const requestItems = items.map(item => ({
    req_id: assetRequest.req_id,
    asset_id: item.asset_id,
    requested_qty: item.requested_qty,
    spare_item: asset_origin === "SITE" ? false : (item.spare_item ?? false),
    company_id: companyId,
}));

        await AssetRequestItem.bulkCreate(requestItems, { transaction });

        // After bulkCreate but BEFORE commit
        const fullRequest = await AssetRequest.findOne({
            where: { req_id: assetRequest.req_id },
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "email", "mobile", "role"],
                },
                {
                    model: User,
                    as: "approvedBy",
                    attributes: ["id", "fullName", "email", "mobile", "role"],
                },
                {
                    model: SiteData,
                    as: "site",
                },
                {
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        {
                            model: Asset,
                            as: "asset",   // 🔥 THIS IS THE FIX
                            attributes: ["asset_name", "units", "make"],
                        },
                    ],
                },
            ],
            transaction,
        });

        // console.log(fullRequest.items, 'items')

        const priorityEmoji = fullRequest.priority_level === "HIGH" ? "🔴" : fullRequest.priority_level === "MEDIUM" ? "🟡" : "🟢";

        const inventoryManagers = await User.findAll({
            where: {
                company_id: companyId,
                role: "INVENTORY_MANAGER",
            },
            attributes: ["email"],
        });

        const ccEmails = inventoryManagers
            .map(user => user.email)
            .filter(email => !!email);

        const ccRecipients = ccEmails.map(email => ({
            emailAddress: { address: email }
        }));

        // 📧 Send approval email via Microsoft Graph
        await sendGraphMail({
            companyId,
            to: fullRequest.approvedBy?.email,
            ccRecipients,
            subject: `${priorityEmoji} New Asset Request | ${fullRequest.site?.location} | ${fullRequest.priority_level} Priority | Approval Required`,
            html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Asset Request</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Segoe UI, Arial, sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;background:#f4f6f9;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<!-- Header -->
<tr>
<td style="background-color:#f3f4f6;padding:30px;">
<h1 style="color:#111827;margin:0;font-size:22px;letter-spacing:0.5px;">
📦 Asset Request Notification
</h1>
<p style="color:#374151;margin:8px 0 0 0;font-size:14px;">
Inventory Management System
</p>
</td>
</tr>

<!-- Status Badge -->
<tr>
<td style="padding:25px 30px 0 30px;">
<span style="
display:inline-block;
padding:6px 14px;
border-radius:50px;
font-size:12px;
font-weight:600;
background:${fullRequest.priority_level === "HIGH" ? "#fee2e2" : fullRequest.priority_level === "MEDIUM" ? "#fef3c7" : "#e0f2fe"};
color:${fullRequest.priority_level === "HIGH" ? "#b91c1c" : fullRequest.priority_level === "MEDIUM" ? "#92400e" : "#075985"};
">
${fullRequest.priority_level} PRIORITY
</span>
</td>
</tr>

<!-- Body -->
<tr>
<td style="padding:20px 30px 10px 30px;color:#374151;font-size:14px;line-height:1.6;">
<p>Hello <strong>${fullRequest.approvedBy?.fullName}</strong>,</p>

<p>
A new asset request has been created and is awaiting your review.
Below are the request details:
</p>
</td>
</tr>

<!-- Request Summary Card -->
<tr>
<td style="padding:10px 30px;">
<table width="100%" style="background:#f9fafb;border-radius:10px;padding:20px;">
<tr>
<td style="font-size:13px;color:#6b7280;">Request ID</td>
<td align="right" style="font-weight:600;color:#111827;">${fullRequest.req_id}</td>
</tr>
<tr>
<td style="font-size:13px;color:#6b7280;padding-top:10px;">Requested By</td>
<td align="right" style="font-weight:600;padding-top:10px;">${fullRequest.requestedBy?.fullName}</td>
</tr>
<tr>
<td style="font-size:13px;color:#6b7280;padding-top:10px;">Site Location</td>
<td align="right" style="font-weight:600;padding-top:10px;">
${fullRequest.site?.location} | Bridge ${fullRequest.site?.bridge_no}
</td>
</tr>
<tr>
<td style="font-size:13px;color:#6b7280;padding-top:10px;">Requested On</td>
<td align="right" style="font-weight:600;padding-top:10px;">
${new Date(fullRequest.requested_at).toLocaleString()}
</td>
</tr>
</table>
</td>
</tr>

<!-- Items Section -->
<tr>
<td style="padding:20px 30px 0 30px;">
<h3 style="margin:0 0 10px 0;color:#111827;font-size:16px;">
Requested Items
</h3>
<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
<tr style="background:#f3f4f6;color:#374151;font-weight:600;">
<td align="left">Asset Name</td>
<td align="center">Qty</td>
</tr>

${fullRequest.items.map(item => {
                const isSpare = item.spare_item;

                const badgeBg = isSpare ? "#fef3c7" : "#e0f2fe";
                const badgeColor = isSpare ? "#92400e" : "#075985";
                const label = isSpare ? "SPARE ITEM" : "REGULAR ITEM";

                return `
<tr style="border-bottom:1px solid #e5e7eb;">
<td style="vertical-align:middle;">
  <span style="font-weight:600;color:#111827;">
    ${item.asset?.asset_name || "N/A"}
  </span>
  <span style="
    display:inline-block;
    margin-left:8px;
    padding:3px 8px;
    font-size:10px;
    font-weight:600;
    border-radius:50px;
    background:${badgeBg};
    color:${badgeColor};
  ">
    ${label}
  </span>
</td>
<td align="center" style="vertical-align:middle;">
  ${item.requested_qty}
</td>
</tr>
`;
            }).join("")}

</table>
</td>
</tr>

<!-- Remarks -->
<tr>
<td style="padding:20px 30px 0 30px;font-size:14px;color:#374151;">
<strong>Remarks:</strong><br/>
${fullRequest.request_remarks || "No additional remarks provided."}
</td>
</tr>

<!-- CTA -->
<tr>
<td align="center" style="padding:30px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:14px 28px;
background:#2563eb;
color:#ffffff;
text-decoration:none;
border-radius:8px;
font-weight:600;
font-size:14px;
box-shadow:0 6px 16px rgba(37,99,235,0.4);
">
Review & Approve Request
</a>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#6b7280;">
This is an automated notification from KDM Engineers Inventory System.<br/>
© ${new Date().getFullYear()} KDM Engineers Group. All rights reserved.
</td>
</tr>

</table>
</td>
</tr>
</table>

</body>
</html>
`
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

        // console.log(requests,'requests')

        res.json(requests);
    } catch (err) {
        next(err);
    }
};


//UPDATE ASSET REQUEST STATUS BY ADMIN

// export const decideAssetRequest = async (req, res) => {
//     const t = await sequelize.transaction();

//     try {
//         const companyId = req.user.company_id;
//         const adminId = req.user.id;
//         const { reqId } = req.params;
//         const { decision, adminAdvice } = req.body;

//         const request = await AssetRequest.findOne({
//             where: {
//                 req_id: reqId,
//                 company_id: companyId,
//             },
//             include: [
//                 {
//                     model: AssetRequestItem,
//                     as: "items",
//                     where: { company_id: companyId },
//                     include: [
//                         {
//                             model: Asset,
//                             as: "asset",
//                             attributes: ["asset_name", "units", "make"],
//                         },
//                     ],
//                 },
//                 {
//                     model: User,
//                     as: "requestedBy",
//                     attributes: ["fullName", "email"],
//                 },
//                 {
//                     model: SiteData,
//                     as: "site",
//                 },
//             ],
//             transaction: t,
//             lock: t.LOCK.UPDATE,
//         });

//         if (!request || request.admin_approval !== "PENDING") {
//             throw new Error("Invalid or already processed request");
//         }

//         /* ================= APPROVAL LOGIC ================= */

//         if (decision === "APPROVED") {

//             /* ================= OFFICE INVENTORY ================= */

//             if (request.asset_origin === "OFFICE") {

//                 for (const item of request.items) {

//                     const asset = await Asset.findOne({
//                         where: {
//                             asset_id: item.asset_id,
//                             company_id: companyId,
//                         },
//                         transaction: t,
//                         lock: t.LOCK.UPDATE,
//                     });

//                     if (!asset || asset.qty < item.requested_qty) {
//                         throw new Error(
//                             `Insufficient office stock for ${asset?.asset_name ?? "Asset"}`
//                         );
//                     }

//                     asset.qty -= item.requested_qty;
//                     await asset.save({ transaction: t });
//                 }
//             }

//             /* ================= SITE INVENTORY ================= */

//             if (request.asset_origin === "SITE") {

//                 const originSiteId = request.origin_site_id;
// // console.log(originSiteId,decision,companyId,'sfnskfjbksfv78899')

//                 const originRequest = await AssetRequest.findOne({
//                     where: {
//                         site_id: originSiteId,
//                         admin_approval: decision,
//                         company_id: companyId,
//                     },
//                     // order: [["createdAt", "DESC"]],
//                     transaction: t,
//                     lock: t.LOCK.UPDATE,
//                 });

//                 console.log(originSiteId,originRequest,'sfnskfjbksfv78899')


//                 if (!originRequest) {
//                     throw new Error("Origin site inventory not found");
//                 }

//                 const originItems = await AssetRequestItem.findAll({
//                     where: {
//                         req_id: originRequest.req_id,
//                         company_id: companyId,
//                     },
//                     transaction: t,
//                     lock: t.LOCK.UPDATE,
//                 });

//                 for (const item of request.items) {

//                     const originItem = originItems.find(
//                         (i) => i.asset_id === item.asset_id
//                     );

//                     if (!originItem || originItem.requested_qty < item.requested_qty) {
//                         throw new Error(`Insufficient site stock for asset ${item.asset_id}`);
//                     }

//                     originItem.requested_qty -= item.requested_qty;

//                     await originItem.save({ transaction: t });
//                 }
//             }
//         }

//         /* ================= UPDATE REQUEST STATUS ================= */
//         await request.update(
//             {
//                 admin_approval: decision,
//                 admin_user_id: adminId,
//                 admin_advice: adminAdvice ?? null,
//             },
//             { transaction: t }
//         );

//         await t.commit();

//         /* ================= SEND EMAIL ================= */

//         const inventoryManagers = await User.findAll({
//             where: {
//                 company_id: companyId,
//                 role: "INVENTORY_MANAGER",
//             },
//             attributes: ["email"],
//         });

//         const ccRecipients = inventoryManagers
//             .map(user => user.email)
//             .filter(Boolean)
//             .map(email => ({
//                 emailAddress: { address: email }
//             }));

//         const subject =
//             decision === "APPROVED"
//                 ? `✅ Request Approved | ${request.site?.location}`
//                 : `❌ Request Rejected | ${request.site?.location}`;

//         const data = request.toJSON();
//         const siteName = data.site?.location ?? "N/A";

//         await sendGraphMail({
//             to: request.requestedBy?.email,
//             ccRecipients,
//             subject,
//             html: 
            
// `
//  <!DOCTYPE html>
//  <html>
//  <body style="margin:0;padding:0;background:#f4f6f9;font-family:Segoe UI, Arial;">

//  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
//  <tr>
//  <td align="center">

//  <table width="600" cellpadding="0" cellspacing="0"
//  style="background:#ffffff;border-radius:12px;overflow:hidden;
//  box-shadow:0 8px 30px rgba(0,0,0,0.08);">

//  <tr>
//  <td style="padding:30px;
//  background:${decision === "APPROVED" ? "#ecfdf5" : "#fef2f2"};">
//  <h2 style="margin:0;
//  color:${decision === "APPROVED" ? "#065f46" : "#991b1b"};">
//  ${decision === "APPROVED" ? "✅ Request Approved" : "❌ Request Rejected"}
//  </h2>
//  <p style="margin-top:6px;font-size:13px;">
//  Inventory Management System
//  </p>
//  </td>
//  </tr>

//  <tr>
//  <td style="padding:30px;color:#374151;font-size:14px;">
//  <p>Hello <strong>${request.requestedBy?.fullName}</strong>,</p>

//  <p>
//  Your asset request for site 
//  <strong>${siteName}</strong>
//  has been <strong>${decision}</strong>.
//  </p>

//  ${decision === "REJECTED" && adminAdvice
//                      ? `
//  <div style="margin:20px 0;padding:15px;background:#f3f4f6;border-radius:8px;">
//  <strong>Admin Remarks:</strong><br/>
//  ${adminAdvice}
//  </div>
//  `
//                      : ""
//                  }

//  <h3 style="margin-top:25px;">Requested Items</h3>

//  <table width="100%" cellpadding="8" cellspacing="0" 
//  style="border-collapse:collapse;font-size:13px;">
//  <tr style="background:#f3f4f6;font-weight:600;">
//  <td>Asset</td>
//  <td align="center">Qty</td>
//  </tr>

//  ${request.items.map(item => {
//                      const isSpare = item.spare_item;

//                      const badgeBg = isSpare ? "#fef3c7" : "#e0f2fe";
//                      const badgeColor = isSpare ? "#92400e" : "#075985";
//                      const label = isSpare ? "SPARE ITEM" : "REGULAR ITEM";

//                      return `
//  <tr style="border-bottom:1px solid #e5e7eb;">
//  <td style="vertical-align:middle;">
//    <span style="font-weight:600;color:#111827;">
//      ${item.asset?.asset_name || "N/A"}
//    </span>
//    <span style="
//      display:inline-block;
//      margin-left:8px;
//      padding:3px 8px;
//      font-size:10px;
//      font-weight:600;
//      border-radius:50px;
//      background:${badgeBg};
//      color:${badgeColor};
//    ">
//      ${label}
//    </span>
//  </td>
//  <td align="center" style="vertical-align:middle;">
//    ${item.requested_qty}
//  </td>
//  </tr>
//  `;
//                  }).join("")}

//  </table>

//  <p style="margin-top:20px;">
//  Priority Level: <strong>${request.priority_level}</strong>
//  </p>

//  </td>
//  </tr>

//  <tr>
//  <td align="center" style="padding:30px;">
//  <a href="https:inventory.kdmengineers.com"
//  style="display:inline-block;
//  padding:14px 28px;
//  background:${decision === "APPROVED" ? "#16a34a" : "#dc2626"};
//  color:#ffffff;
//  text-decoration:none;
//  border-radius:8px;
//  font-weight:600;">
//  View Request
//  </a>
//  </td>
//  </tr>

//  <tr>
//  <td style="background:#f9fafb;padding:20px;text-align:center;
//  font-size:12px;color:#6b7280;">
//  © ${new Date().getFullYear()} KDM Engineers Group.
//  </td>
//  </tr>

//  </table>
//  </td>
//  </tr>
//  </table>

//  </body>
//  </html>
//  `

//         });

//         res.json({ success: true });

//     } catch (err) {
//         await t.rollback();
//         res.status(400).json({ message: err.message });
//     }
// };


export const decideAssetRequest = async (req, res) => {

    const t = await sequelize.transaction();

    try {

        const companyId = req.user.company_id;
        const adminId = req.user.id;
        const { reqId } = req.params;
        const { decision, adminAdvice } = req.body;

        const purchaseRequirements = [];

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
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            attributes: ["asset_name", "units", "make"],
                        },
                    ],
                },
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["fullName", "email"],
                },
                {
                    model: SiteData,
                    as: "site",
                },
            ],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!request || request.admin_approval !== "PENDING") {
            throw new Error("Invalid or already processed request");
        }

        /* -------------------------------------------------- */
        /* 🔹 HISTORY SAVE (REQUEST SNAPSHOT) */
        /* -------------------------------------------------- */

        await AssetRequestHistory.create(
            {
                ...request.toJSON(),
                action_type: 'CREATED',
                action_by: adminId,
                admin_approval:decision
            },
            { transaction: t }
        );

        /* -------------------------------------------------- */
        /* 🔹 HISTORY SAVE (ITEM SNAPSHOTS) */
        /* -------------------------------------------------- */

        for (const item of request.items) {

            await AssetRequestItemHistory.create(
                {
                    ...item.toJSON(),
                    original_item_id: item.id,
                    action_type: 'CREATED',
                },
                { transaction: t }
            );

        }

        /* ================= APPROVAL LOGIC ================= */

        if (decision === "APPROVED") {

            /* ================= OFFICE INVENTORY ================= */

            if (request.asset_origin === "OFFICE") {

                for (const item of request.items) {

                    const asset = await Asset.findOne({
                        where: {
                            asset_id: item.asset_id,
                            company_id: companyId,
                        },
                        transaction: t,
                        lock: t.LOCK.UPDATE,
                    });

                    if (!asset) {
                        throw new Error(`Asset not found`);
                    }

                    const available = asset.qty;
                    const requested = item.requested_qty;

                    if (available >= requested) {

                        asset.qty -= requested;

                    } else {

                        const toPurchase = requested - available;

                        purchaseRequirements.push({
                            asset_name: asset.asset_name,
                            units: asset.units,
                            available,
                            requested,
                            toPurchase,
                            origin: "OFFICE"
                        });

                        asset.qty = 0;
                    }

                    await asset.save({ transaction: t });
                }
            }

            /* ================= SITE INVENTORY ================= */

            if (request.asset_origin === "SITE") {

                const originSiteId = request.origin_site_id;

                const originRequest = await AssetRequest.findOne({
                    where: {
                        site_id: originSiteId,
                        admin_approval: decision,
                        company_id: companyId,
                    },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

                if (!originRequest) {
                    throw new Error("Origin site inventory not found");
                }

                const originItems = await AssetRequestItem.findAll({
                    where: {
                        req_id: originRequest.req_id,
                        company_id: companyId,
                    },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

                for (const item of request.items) {

                    const originItem = originItems.find(
                        (i) => i.asset_id === item.asset_id
                    );

                    if (!originItem) {
                        throw new Error(`Origin site asset not found`);
                    }

                    const available = originItem.requested_qty;
                    const requested = item.requested_qty;

                    if (available >= requested) {

                        originItem.requested_qty -= requested;

                    } else {

                        const toPurchase = requested - available;

                        purchaseRequirements.push({
                            asset_name: item.asset?.asset_name || "Asset",
                            units: item.asset?.units || "",
                            available,
                            requested,
                            toPurchase,
                            origin: "SITE"
                        });

                        originItem.requested_qty = 0;
                    }

                    await originItem.save({ transaction: t });
                }
            }
        }

        /* ================= UPDATE REQUEST STATUS ================= */

        await request.update(
            {
                admin_approval: decision,
                admin_user_id: adminId,
                admin_advice: adminAdvice ?? null,
            },
            { transaction: t }
        );

        await t.commit();

        /* ================= EMAIL LOGIC (UNCHANGED) ================= */

        // your existing email logic remains exactly the same
                const inventoryManagers = await User.findAll({
            where: {
                company_id: companyId,
                role: "INVENTORY_MANAGER",
            },
            attributes: ["email"],
        });

        const ccRecipients = inventoryManagers
            .map(user => user.email)
            .filter(Boolean)
            .map(email => ({
                emailAddress: { address: email }
            }));

        const subject =
            decision === "APPROVED"
                ? `✅ Request Approved | ${request.site?.location}`
                : `❌ Request Rejected | ${request.site?.location}`;

        const data = request.toJSON();
        const siteName = data.site?.location ?? "N/A";

        /* ================= PURCHASE SECTION ================= */

        let purchaseSection = "";

        if (purchaseRequirements.length > 0) {

            purchaseSection = `
            <h3 style="margin-top:25px;color:#b91c1c;">
            ⚠️ Additional Assets Required
            </h3>

            <table width="100%" cellpadding="8" cellspacing="0"
            style="border-collapse:collapse;font-size:13px;border:1px solid #fecaca;">

            <tr style="background:#fee2e2;font-weight:600;">
            <td>Asset</td>
            <td align="center">Requested</td>
            <td align="center">Available</td>
            <td align="center">Need to Purchase</td>
            <td align="center">Source</td>
            </tr>

            ${purchaseRequirements.map(p => `
            <tr style="border-bottom:1px solid #fecaca;">
            <td>${p.asset_name}</td>
            <td align="center">${p.requested}</td>
            <td align="center">${p.available}</td>
            <td align="center" style="color:#b91c1c;font-weight:600;">
            ${p.toPurchase} ${p.units}
            </td>
            <td align="center">${p.origin}</td>
            </tr>
            `).join("")}

            </table>

            <p style="margin-top:10px;color:#b91c1c;">
            Please arrange purchase of the above assets.
            </p>
            `;
        }

        await sendGraphMail({
             companyId,
            to: request.requestedBy?.email,
            ccRecipients,
            subject,
            html: `

 <!DOCTYPE html>
 <html>
 <body style="margin:0;padding:0;background:#f4f6f9;font-family:Segoe UI, Arial;">

 <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
 <tr>
 <td align="center">

 <table width="600" cellpadding="0" cellspacing="0"
 style="background:#ffffff;border-radius:12px;overflow:hidden;
 box-shadow:0 8px 30px rgba(0,0,0,0.08);">

 <tr>
 <td style="padding:30px;
 background:${decision === "APPROVED" ? "#ecfdf5" : "#fef2f2"};">
 <h2 style="margin:0;
 color:${decision === "APPROVED" ? "#065f46" : "#991b1b"};">
 ${decision === "APPROVED" ? "✅ Request Approved" : "❌ Request Rejected"}
 </h2>
 <p style="margin-top:6px;font-size:13px;">
 Inventory Management System
 </p>
 </td>
 </tr>

 <tr>
 <td style="padding:30px;color:#374151;font-size:14px;">
 <p>Hello <strong>${request.requestedBy?.fullName}</strong>,</p>

 <p>
 Your asset request for site 
 <strong>${siteName}</strong>
 has been <strong>${decision}</strong>.
 </p>

 <h3 style="margin-top:25px;">Requested Items</h3>

 <table width="100%" cellpadding="8" cellspacing="0" 
 style="border-collapse:collapse;font-size:13px;">
 <tr style="background:#f3f4f6;font-weight:600;">
 <td>Asset</td>
 <td align="center">Qty</td>
 </tr>

 ${request.items.map(item => `
 <tr style="border-bottom:1px solid #e5e7eb;">
 <td>${item.asset?.asset_name || "N/A"}</td>
 <td align="center">${item.requested_qty}</td>
 </tr>
 `).join("")}

 </table>

 ${purchaseSection}

 <p style="margin-top:20px;">
 Priority Level: <strong>${request.priority_level}</strong>
 </p>

 </td>
 </tr>

 </table>
 </td>
 </tr>
 </table>

 </body>
 </html>
 `
        });

        res.json({ success: true });

    } catch (err) {

        await t.rollback();

        res.status(400).json({
            message: err.message
        });

    }
};



// export const decideAssetRequest = async (req, res) => {
//     const t = await sequelize.transaction();

//     try {
//         const companyId = req.user.company_id;
//         const adminId = req.user.id;
//         const { reqId } = req.params;
//         const { decision, adminAdvice } = req.body;

//         const purchaseRequirements = [];

//         const request = await AssetRequest.findOne({
//             where: {
//                 req_id: reqId,
//                 company_id: companyId,
//             },
//             include: [
//                 {
//                     model: AssetRequestItem,
//                     as: "items",
//                     where: { company_id: companyId },
//                     include: [
//                         {
//                             model: Asset,
//                             as: "asset",
//                             attributes: ["asset_name", "units", "make"],
//                         },
//                     ],
//                 },
//                 {
//                     model: User,
//                     as: "requestedBy",
//                     attributes: ["fullName", "email"],
//                 },
//                 {
//                     model: SiteData,
//                     as: "site",
//                 },
//             ],
//             transaction: t,
//             lock: t.LOCK.UPDATE,
//         });

//         if (!request || request.admin_approval !== "PENDING") {
//             throw new Error("Invalid or already processed request");
//         }

//         /* ================= APPROVAL LOGIC ================= */

//         if (decision === "APPROVED") {

//             /* ================= OFFICE INVENTORY ================= */

//             if (request.asset_origin === "OFFICE") {

//                 for (const item of request.items) {

//                     const asset = await Asset.findOne({
//                         where: {
//                             asset_id: item.asset_id,
//                             company_id: companyId,
//                         },
//                         transaction: t,
//                         lock: t.LOCK.UPDATE,
//                     });

//                     if (!asset) {
//                         throw new Error(`Asset not found`);
//                     }

//                     const available = asset.qty;
//                     const requested = item.requested_qty;

//                     if (available >= requested) {

//                         asset.qty -= requested;

//                     } else {

//                         const toPurchase = requested - available;

//                         purchaseRequirements.push({
//                             asset_name: asset.asset_name,
//                             units: asset.units,
//                             available,
//                             requested,
//                             toPurchase,
//                             origin: "OFFICE"
//                         });

//                         asset.qty = 0;
//                     }

//                     await asset.save({ transaction: t });
//                 }
//             }

//             /* ================= SITE INVENTORY ================= */

//             if (request.asset_origin === "SITE") {

//                 const originSiteId = request.origin_site_id;

//                 const originRequest = await AssetRequest.findOne({
//                     where: {
//                         site_id: originSiteId,
//                         admin_approval: decision,
//                         company_id: companyId,
//                     },
//                     transaction: t,
//                     lock: t.LOCK.UPDATE,
//                 });

//                 if (!originRequest) {
//                     throw new Error("Origin site inventory not found");
//                 }

//                 const originItems = await AssetRequestItem.findAll({
//                     where: {
//                         req_id: originRequest.req_id,
//                         company_id: companyId,
//                     },
//                     transaction: t,
//                     lock: t.LOCK.UPDATE,
//                 });

//                 for (const item of request.items) {

//                     const originItem = originItems.find(
//                         (i) => i.asset_id === item.asset_id
//                     );

//                     if (!originItem) {
//                         throw new Error(`Origin site asset not found`);
//                     }

//                     const available = originItem.requested_qty;
//                     const requested = item.requested_qty;

//                     if (available >= requested) {

//                         originItem.requested_qty -= requested;

//                     } else {

//                         const toPurchase = requested - available;

//                         purchaseRequirements.push({
//                             asset_name: item.asset?.asset_name || "Asset",
//                             units: item.asset?.units || "",
//                             available,
//                             requested,
//                             toPurchase,
//                             origin: "SITE"
//                         });

//                         originItem.requested_qty = 0;
//                     }

//                     await originItem.save({ transaction: t });
//                 }
//             }
//         }

//         /* ================= UPDATE REQUEST STATUS ================= */

//         await request.update(
//             {
//                 admin_approval: decision,
//                 admin_user_id: adminId,
//                 admin_advice: adminAdvice ?? null,
//             },
//             { transaction: t }
//         );

//         await t.commit();

//         /* ================= SEND EMAIL ================= */

//         const inventoryManagers = await User.findAll({
//             where: {
//                 company_id: companyId,
//                 role: "INVENTORY_MANAGER",
//             },
//             attributes: ["email"],
//         });

//         const ccRecipients = inventoryManagers
//             .map(user => user.email)
//             .filter(Boolean)
//             .map(email => ({
//                 emailAddress: { address: email }
//             }));

//         const subject =
//             decision === "APPROVED"
//                 ? `✅ Request Approved | ${request.site?.location}`
//                 : `❌ Request Rejected | ${request.site?.location}`;

//         const data = request.toJSON();
//         const siteName = data.site?.location ?? "N/A";

//         /* ================= PURCHASE SECTION ================= */

//         let purchaseSection = "";

//         if (purchaseRequirements.length > 0) {

//             purchaseSection = `
//             <h3 style="margin-top:25px;color:#b91c1c;">
//             ⚠️ Additional Assets Required
//             </h3>

//             <table width="100%" cellpadding="8" cellspacing="0"
//             style="border-collapse:collapse;font-size:13px;border:1px solid #fecaca;">

//             <tr style="background:#fee2e2;font-weight:600;">
//             <td>Asset</td>
//             <td align="center">Requested</td>
//             <td align="center">Available</td>
//             <td align="center">Need to Purchase</td>
//             <td align="center">Source</td>
//             </tr>

//             ${purchaseRequirements.map(p => `
//             <tr style="border-bottom:1px solid #fecaca;">
//             <td>${p.asset_name}</td>
//             <td align="center">${p.requested}</td>
//             <td align="center">${p.available}</td>
//             <td align="center" style="color:#b91c1c;font-weight:600;">
//             ${p.toPurchase} ${p.units}
//             </td>
//             <td align="center">${p.origin}</td>
//             </tr>
//             `).join("")}

//             </table>

//             <p style="margin-top:10px;color:#b91c1c;">
//             Please arrange purchase of the above assets.
//             </p>
//             `;
//         }

//         await sendGraphMail({
//             to: request.requestedBy?.email,
//             ccRecipients,
//             subject,
//             html: `

//  <!DOCTYPE html>
//  <html>
//  <body style="margin:0;padding:0;background:#f4f6f9;font-family:Segoe UI, Arial;">

//  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
//  <tr>
//  <td align="center">

//  <table width="600" cellpadding="0" cellspacing="0"
//  style="background:#ffffff;border-radius:12px;overflow:hidden;
//  box-shadow:0 8px 30px rgba(0,0,0,0.08);">

//  <tr>
//  <td style="padding:30px;
//  background:${decision === "APPROVED" ? "#ecfdf5" : "#fef2f2"};">
//  <h2 style="margin:0;
//  color:${decision === "APPROVED" ? "#065f46" : "#991b1b"};">
//  ${decision === "APPROVED" ? "✅ Request Approved" : "❌ Request Rejected"}
//  </h2>
//  <p style="margin-top:6px;font-size:13px;">
//  Inventory Management System
//  </p>
//  </td>
//  </tr>

//  <tr>
//  <td style="padding:30px;color:#374151;font-size:14px;">
//  <p>Hello <strong>${request.requestedBy?.fullName}</strong>,</p>

//  <p>
//  Your asset request for site 
//  <strong>${siteName}</strong>
//  has been <strong>${decision}</strong>.
//  </p>

//  <h3 style="margin-top:25px;">Requested Items</h3>

//  <table width="100%" cellpadding="8" cellspacing="0" 
//  style="border-collapse:collapse;font-size:13px;">
//  <tr style="background:#f3f4f6;font-weight:600;">
//  <td>Asset</td>
//  <td align="center">Qty</td>
//  </tr>

//  ${request.items.map(item => `
//  <tr style="border-bottom:1px solid #e5e7eb;">
//  <td>${item.asset?.asset_name || "N/A"}</td>
//  <td align="center">${item.requested_qty}</td>
//  </tr>
//  `).join("")}

//  </table>

//  ${purchaseSection}

//  <p style="margin-top:20px;">
//  Priority Level: <strong>${request.priority_level}</strong>
//  </p>

//  </td>
//  </tr>

//  </table>
//  </td>
//  </tr>
//  </table>

//  </body>
//  </html>
//  `
//         });

//         res.json({ success: true });

//     } catch (err) {
//         await t.rollback();
//         res.status(400).json({ message: err.message });
//     }
// };


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
//     const companyId = req.user.company_id;

//     const transaction = await sequelize.transaction();

//     try {
//         // 1️⃣ Fetch request (company scoped)
//         const request = await AssetRequest.findOne({
//             where: {
//                 req_id: reqId,
//                 company_id: companyId,
//             },
//             transaction,
//             lock: transaction.LOCK.UPDATE,
//         });

//         if (!request) {
//             await transaction.rollback();
//             return res.status(404).json({ message: "Request not found" });
//         }

//         if (request.admin_approval !== "APPROVED") {
//             await transaction.rollback();
//             return res.status(400).json({
//                 message: "Request must be approved first",
//             });
//         }

//         // 2️⃣ Check allocated request for same site + same company
//         const existingAllocatedRequest = await AssetRequest.findOne({
//             where: {
//                 site_id: request.site_id,
//                 allocated: 1,
//                 company_id: companyId,
//             },
//             transaction,
//             lock: transaction.LOCK.UPDATE,
//         });

//         if (existingAllocatedRequest) {
//             // 3️⃣ Merge items
//             await AssetRequestItem.update(
//                 { req_id: existingAllocatedRequest.req_id },
//                 {
//                     where: {
//                         req_id: request.req_id,
//                         company_id: companyId,
//                     },
//                     transaction,
//                 }
//             );

//             await AssetRequest.destroy({
//                 where: {
//                     req_id: request.req_id,
//                     company_id: companyId,
//                 },
//                 transaction,
//             });

//             await transaction.commit();

//             return res.json({
//                 success: true,
//                 message: "Request items merged into existing allocated request",
//                 merged_into_req_id: existingAllocatedRequest.req_id,
//             });
//         }

//         // 4️⃣ Allocate current request
//         await request.update(
//             { allocated: 1 },
//             { transaction }
//         );

//         // After bulkCreate but BEFORE commit
//         const fullRequest = await AssetRequest.findOne({
//             where: { req_id: reqId },
//             include: [
//                 {
//                     model: User,
//                     as: "requestedBy",
//                     attributes: ["id", "fullName", "email", "mobile", "role"],
//                 },
//                 {
//                     model: User,
//                     as: "approvedBy",
//                     attributes: ["id", "fullName", "email", "mobile", "role"],
//                 },
//                 {
//                     model: SiteData,
//                     as: "site",
//                 },
//                 {
//                     model: AssetRequestItem,
//                     as: "items",
//                     include: [
//                         {
//                             model: Asset,
//                             as: "asset",   // 🔥 THIS IS THE FIX
//                             attributes: ["asset_name", "units", "make"],
//                         },
//                     ],
//                 },
//             ],
//             transaction,
//         });

//         const inventoryManagers = await User.findAll({
//             where: {
//                 company_id: companyId,
//                 role: "INVENTORY_MANAGER",
//             },
//             attributes: ["email"],
//         });

//         const ccEmails = inventoryManagers
//             .map(user => user.email)
//             .filter(email => !!email); 

//         const ccRecipients = ccEmails.map(email => ({
//             emailAddress: { address: email }
//         }));

//         await sendGraphMail({
//             to: fullRequest.approvedBy?.email, ccRecipients,
//             subject: `✅ Assets Allocated | ${fullRequest.site?.location} | Request ID ${fullRequest.req_id}`,
//             html: `
// <!DOCTYPE html>
// <html>
// <head>
// <meta charset="UTF-8" />
// <meta name="viewport" content="width=device-width, initial-scale=1.0" />
// <title>Asset Allocation Confirmation</title>
// </head>
// <body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Segoe UI, Arial, sans-serif;">

// <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;background:#f4f6f9;">
// <tr>
// <td align="center">

// <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

// <!-- Header -->
// <tr>
// <td style="background-color:#ecfdf5;padding:30px;">
// <h1 style="color:#065f46;margin:0;font-size:22px;letter-spacing:0.5px;">
// ✅ Asset Allocation Confirmed
// </h1>
// <p style="color:#047857;margin:8px 0 0 0;font-size:14px;">
// Inventory Management System
// </p>
// </td>
// </tr>

// <!-- Body -->
// <tr>
// <td style="padding:25px 30px 10px 30px;color:#374151;font-size:14px;line-height:1.6;">
// <p>Hello <strong>${fullRequest.approvedBy?.fullName}</strong>,</p>

// <p>
// This is to inform you that the approved asset request has been successfully 
// <strong>allocated and handed over</strong> to 
// <strong>${fullRequest.requestedBy?.fullName}</strong> 
// at the designated site.
// </p>
// </td>
// </tr>

// <!-- Summary Card -->
// <tr>
// <td style="padding:10px 30px;">
// <table width="100%" style="background:#f9fafb;border-radius:10px;padding:20px;">
// <tr>
// <td style="font-size:13px;color:#6b7280;">Request ID</td>
// <td align="right" style="font-weight:600;color:#111827;">${fullRequest.req_id}</td>
// </tr>
// <tr>
// <td style="font-size:13px;color:#6b7280;padding-top:10px;">Site Location</td>
// <td align="right" style="font-weight:600;padding-top:10px;">
// ${fullRequest.site?.location} | Bridge ${fullRequest.site?.bridge_no}
// </td>
// </tr>
// <tr>
// <td style="font-size:13px;color:#6b7280;padding-top:10px;">Allocated On</td>
// <td align="right" style="font-weight:600;padding-top:10px;">
// ${new Date().toLocaleString()}
// </td>
// </tr>
// </table>
// </td>
// </tr>

// <!-- Items -->
// <tr>
// <td style="padding:20px 30px 0 30px;">
// <h3 style="margin:0 0 10px 0;color:#111827;font-size:16px;">
// Allocated Items
// </h3>
// <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
// <tr style="background:#f3f4f6;color:#374151;font-weight:600;">
// <td align="left">Asset Name</td>
// <td align="center">Quantity</td>
// </tr>
// ${fullRequest.items.map(item => {
//                 const isSpare = item.spare_item;

//                 const badgeBg = isSpare ? "#fef3c7" : "#e0f2fe";
//                 const badgeColor = isSpare ? "#92400e" : "#075985";
//                 const label = isSpare ? "SPARE ITEM" : "REGULAR ITEM";

//                 return `
// <tr style="border-bottom:1px solid #e5e7eb;">
// <td style="vertical-align:middle;">
//   <span style="font-weight:600;color:#111827;">
//     ${item.asset?.asset_name || "N/A"}
//   </span>
//   <span style="
//     display:inline-block;
//     margin-left:8px;
//     padding:3px 8px;
//     font-size:10px;
//     font-weight:600;
//     border-radius:50px;
//     background:${badgeBg};
//     color:${badgeColor};
//   ">
//     ${label}
//   </span>
// </td>
// <td align="center" style="vertical-align:middle;">
//   ${item.requested_qty}
// </td>
// </tr>
// `;
//             }).join("")}
// </table>
// </td>
// </tr>

// <!-- Footer Message -->
// <tr>
// <td style="padding:25px 30px;font-size:14px;color:#374151;">
// This serves as an official acknowledgment that the above assets 
// have been delivered and recorded in the system.
// </td>
// </tr>

// <!-- CTA -->
// <tr>
// <td align="center" style="padding:30px;">
// <a href="https://inventory.kdmengineers.com"
// style="
// display:inline-block;
// padding:14px 28px;
// background:#16a34a;
// color:#ffffff;
// text-decoration:none;
// border-radius:8px;
// font-weight:600;
// font-size:14px;
// box-shadow:0 6px 16px rgba(22,163,74,0.4);
// ">
// View Allocation Details
// </a>
// </td>
// </tr>

// <!-- Footer -->
// <tr>
// <td style="background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#6b7280;">
// This is an automated confirmation from KDM Engineers Inventory System.<br/>
// © ${new Date().getFullYear()} KDM Engineers Group. All rights reserved.
// </td>
// </tr>

// </table>
// </td>
// </tr>
// </table>

// </body>
// </html>
// `
//         });

//         await transaction.commit();

//         return res.json({
//             success: true,
//             message: "Request allocated successfully",
//             req_id: request.req_id,
//         });
//     } catch (error) {
//         await transaction.rollback();
//         console.error("allocateAssetRequest error:", error);

//         return res.status(500).json({
//             message: "Failed to allocate request",
//         });
//     }
// };

export const allocateAssetRequest = async (req, res) => {
    const { reqId } = req.params;
    const companyId = req.user.company_id

    const transaction = await sequelize.transaction();

    try {

        // 1️⃣ Fetch request
        const request = await AssetRequest.findOne({
            where: {
                req_id: reqId,
                company_id: companyId,
            },
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "email"],
                },
                {
                    model: User,
                    as: "approvedBy",
                    attributes: ["id", "fullName", "email"],
                },
                {
                    model: SiteData,
                    as: "site",
                },
                {
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        {
                            model: Asset,
                            as: "asset",
                            attributes: ["asset_name", "units", "make"],
                        },
                    ],
                },
            ],
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!request) {
            await transaction.rollback();
            return res.status(404).json({
                message: "Request not found",
            });
        }

        if (request.admin_approval !== "APPROVED") {
            await transaction.rollback();
            return res.status(400).json({
                message: "Request must be approved first",
            });
        }

        // 2️⃣ Update allocated flag
        await request.update(
            { allocated: 1 },
            { transaction }
        );

        // 3️⃣ Get inventory managers for CC
        const inventoryManagers = await User.findAll({
            where: {
                company_id: companyId,
                role: "INVENTORY_MANAGER",
            },
            attributes: ["email"],
            transaction,
        });

        const ccRecipients = inventoryManagers
            .map((u) => ({
                emailAddress: { address: u.email },
            }));

           await sendGraphMail({
             companyId,
    to: [
    request.approvedBy?.email,
    request.requestedBy?.email
  ],
    ccRecipients,
    subject: `📦 Assets Dispatched | ${request.site?.location}`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Segoe UI, Arial;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:12px;overflow:hidden;
box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<!-- HEADER -->
<tr>
<td style="padding:30px;background:#ecfdf5;">
<h2 style="margin:0;color:#065f46;">
📦 Assets Dispatched
</h2>
<p style="margin-top:6px;font-size:13px;">
Inventory Management System
</p>
</td>
</tr>

<!-- BODY -->
<tr>
<td style="padding:30px;color:#374151;font-size:14px;">

<p>Hello <strong>${request.approvedBy?.fullName}</strong>,</p>

<p>
The approved asset request has been successfully 
<strong>dispatched</strong> to 
<strong>${request.requestedBy?.fullName}</strong>.
</p>

<p>
<strong>Request ID:</strong> ${request.req_id}<br/>
<strong>Site:</strong> ${request.site?.location ?? "N/A"}<br/>
<strong>Dispatched On:</strong> ${new Date().toLocaleString()}
</p>

<h3 style="margin-top:25px;">Dispatched Items</h3>

<table width="100%" cellpadding="8" cellspacing="0" 
style="border-collapse:collapse;font-size:13px;">
<tr style="background:#f3f4f6;font-weight:600;">
<td>Asset</td>
<td align="center">Qty</td>
</tr>

${request.items.map(item => {

    const isSpare = item.spare_item;

    const badgeBg = isSpare ? "#fef3c7" : "#e0f2fe";
    const badgeColor = isSpare ? "#92400e" : "#075985";
    const label = isSpare ? "SPARE ITEM" : "REGULAR ITEM";

    return `
<tr style="border-bottom:1px solid #e5e7eb;">
<td style="vertical-align:middle;">
<span style="font-weight:600;color:#111827;">
${item.asset?.asset_name || "N/A"}
</span>

<span style="
display:inline-block;
margin-left:8px;
padding:3px 8px;
font-size:10px;
font-weight:600;
border-radius:50px;
background:${badgeBg};
color:${badgeColor};
">
${label}
</span>

</td>

<td align="center">
${item.requested_qty} ${item.asset?.units ?? ""}
</td>

</tr>
`;

}).join("")}

</table>

</td>
</tr>

<!-- CTA -->
<tr>
<td align="center" style="padding:30px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:14px 28px;
background:#16a34a;
color:#ffffff;
text-decoration:none;
border-radius:8px;
font-weight:600;">
View Allocation
</a>
</td>
</tr>

<!-- FOOTER -->
<tr>
<td style="background:#f9fafb;padding:20px;text-align:center;
font-size:12px;color:#6b7280;">
© ${new Date().getFullYear()} KDM Engineers Group.
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`
});

        await transaction.commit();

        return res.json({
            success: true,
            message: "Request allocated successfully",
            req_id: request.req_id,
        });

    } catch (error) {

        if (!transaction.finished) {
            await transaction.rollback();
        }

        console.error("allocateAssetRequest error:", error);

        return res.status(500).json({
            message: "Failed to allocate request",
        });
    }
};

//MARK ASSET REQUEST AS RECEIVED
export const markAssetsReceived = async (req, res) => {
    const { reqId } = req.params;
    const { remarks } = req.body;
    const companyId = req.user.company_id;

    const transaction = await sequelize.transaction();

    try {

        /* -------------------------------------------------- */
        /* 1️⃣ Fetch request */
        /* -------------------------------------------------- */

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
            return res.status(404).json({
                message: "Request not found",
            });
        }

        if (request.admin_approval !== "APPROVED" || !request.allocated) {
            await transaction.rollback();
            return res.status(400).json({
                message: "Assets must be dispatched before marking received",
            });
        }

        /* -------------------------------------------------- */
        /* 2️⃣ Fetch request items (for email BEFORE merge) */
        /* -------------------------------------------------- */

        const requestItems = await AssetRequestItem.findAll({
            where: {
                req_id: request.req_id,
                company_id: companyId,
            },
            include: [
                {
                    model: Asset,
                    as: "asset",
                    attributes: ["asset_name", "units", "make"],
                },
            ],
            transaction,
        });

        /* -------------------------------------------------- */
        /* 3️⃣ Check if received request already exists */
        /* -------------------------------------------------- */

        const existingReceivedRequest = await AssetRequest.findOne({
            where: {
                site_id: request.site_id,
                allocated: true,
                received_assets: true,
                company_id: companyId,
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        let emailReqId = reqId;
        let mergedIntoReqId = null;

        /* -------------------------------------------------- */
        /* 4️⃣ Merge logic */
        /* -------------------------------------------------- */

        if (existingReceivedRequest) {

            await AssetRequestItem.update(
                { req_id: existingReceivedRequest.req_id },
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

            mergedIntoReqId = existingReceivedRequest.req_id;
            emailReqId = existingReceivedRequest.req_id;

        } else {

            /* -------------------------------------------------- */
            /* 5️⃣ Mark as received */
            /* -------------------------------------------------- */

            await request.update(
                {
                    received_assets: true,
                    received_asset_remarks: remarks || null,
                },
                { transaction }
            );
        }

        /* -------------------------------------------------- */
        /* 6️⃣ Fetch request info for email (WITHOUT items) */
        /* -------------------------------------------------- */

        const fullRequest = await AssetRequest.findOne({
            where: { req_id: emailReqId },
            include: [
                {
                    model: User,
                    as: "requestedBy",
                    attributes: ["id", "fullName", "email", "mobile", "role"],
                },
                {
                    model: User,
                    as: "approvedBy",
                    attributes: ["id", "fullName", "email", "mobile", "role"],
                },
                {
                    model: SiteData,
                    as: "site",
                }
            ],
            transaction,
        });

        /* -------------------------------------------------- */
        /* 7️⃣ CC Inventory Managers */
        /* -------------------------------------------------- */

        const inventoryManagers = await User.findAll({
            where: {
                company_id: companyId,
                role: "INVENTORY_MANAGER",
            },
            attributes: ["email"],
        });

        const ccRecipients = inventoryManagers
            .filter(u => !!u.email)
            .map(u => ({
                emailAddress: { address: u.email }
            }));

        await transaction.commit();

        /* -------------------------------------------------- */
        /* 8️⃣ Send email */
        /* -------------------------------------------------- */

        if (fullRequest?.approvedBy?.email) {

            await sendGraphMail({
                 companyId,
                to: fullRequest.approvedBy.email,
                ccRecipients,
                subject: `📦 Assets Received | ${fullRequest.site?.location} | Request ${reqId}`,
                html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Segoe UI, Arial">

<table width="100%" style="padding:40px;background:#f4f6f9">
<tr>
<td align="center">

<table width="600" style="background:#fff;border-radius:12px;overflow:hidden">

<tr>
<td style="background:#e0f2fe;padding:30px">
<h2 style="margin:0;color:#075985">📦 Assets Successfully Received</h2>
<p style="margin:5px 0 0 0;color:#0369a1;font-size:14px">
Inventory Management System
</p>
</td>
</tr>

<tr>
<td style="padding:25px 30px;font-size:14px;color:#374151">

<p>Hello <strong>${fullRequest.requestedBy?.fullName}</strong>,</p>

<p>
The assets dispatched for the following site have been successfully
<strong>received and recorded</strong> in the system.
</p>

</td>
</tr>

<tr>
<td style="padding:10px 30px">

<table width="100%" style="background:#f9fafb;border-radius:10px;padding:20px;font-size:13px">

<tr>
<td style="color:#6b7280">Request ID</td>
<td align="right"><strong>${reqId}</strong></td>
</tr>

<tr>
<td style="color:#6b7280;padding-top:10px">Site</td>
<td align="right" style="padding-top:10px">
${fullRequest.site?.location} | Bridge ${fullRequest.site?.bridge_no}
</td>
</tr>

<tr>
<td style="color:#6b7280;padding-top:10px">Received On</td>
<td align="right" style="padding-top:10px">
${new Date().toLocaleString()}
</td>
</tr>

</table>

</td>
</tr>

<tr>
<td style="padding:20px 30px">

<h3 style="margin:0 0 10px 0;font-size:16px">Received Items</h3>

<table width="100%" cellpadding="8" style="font-size:13px;border-collapse:collapse">

<tr style="background:#f3f4f6;font-weight:600">
<td>Asset</td>
<td align="center">Qty</td>
</tr>

${requestItems.map(item => {

    const isSpare = item.spare_item;

    const badgeBg = isSpare ? "#fef3c7" : "#e0f2fe";
    const badgeColor = isSpare ? "#92400e" : "#075985";
    const label = isSpare ? "SPARE ITEM" : "REGULAR ITEM";

    return `
<tr style="border-bottom:1px solid #e5e7eb;">
<td>
<span style="font-weight:600;color:#111827;">
${item.asset?.asset_name || "N/A"}
</span>

<span style="
display:inline-block;
margin-left:8px;
padding:3px 8px;
font-size:10px;
font-weight:600;
border-radius:50px;
background:${badgeBg};
color:${badgeColor};
">
${label}
</span>
</td>

<td align="center">
${item.requested_qty} ${item.asset?.units ?? ""}
</td>
</tr>
`;

}).join("")}

</table>

</td>
</tr>

<tr>
<td style="padding:25px 30px;font-size:13px;color:#6b7280">
Remarks: ${remarks || "None"}
</td>
</tr>

<tr>
<td align="center" style="padding:30px">

<a href="https://inventory.kdmengineers.com"
style="padding:14px 28px;background:#0284c7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
View Details
</a>

</td>
</tr>

<tr>
<td style="background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#6b7280">
© ${new Date().getFullYear()} KDM Engineers Group
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`
            });

        }

        return res.json({
            success: true,
            message: mergedIntoReqId
                ? "Items merged into existing received request"
                : "Assets marked as received",
            req_id: emailReqId,
            merged_into_req_id: mergedIntoReqId,
        });

    } catch (error) {

        await transaction.rollback();

        console.error("markAssetsReceived error:", error);

        return res.status(500).json({
            message: "Failed to mark assets received",
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
                allocated: 1,received_assets:1,
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



//FETCHING ASSETS DETAILS BASED ON ALL THE ACTIVE SITES FOR ASSET CLASSIFICATION 
export const getAllocatedAssetRequestsByActiveSites = async (req, res, next) => {
    try {
        const companyId = req.user.company_id;
        // console.log(companyId,'requests098')

        const today = new Date();

        const requests = await AssetRequest.findAll({
    where: {
        admin_approval: "APPROVED",
        allocated: true,received_assets:true,
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
            required: true,
            where: {
                company_id: companyId,
                [Op.or]: [
                    { site_last_date: null },
                    { site_last_date: { [Op.gte]: today } },
                ],
            },
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
                        "asset_type",
                        "asset_condition",
                        "asset_status",
                        "remarks",
                        "asset_image",
                    ],
                },
                {
                    model: AssetRequestItemImage,
                    as: "images",
                    where: {
                        [Op.or]: [
                            { company_id: companyId },
                            { company_id: null },
                        ],
                    },
                    required: false,
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
                            required: false,
                            where: {
                                "$items.returnRequests.status$": {
                                    [Op.ne]: "APPROVED",
                                },
                            },
                            attributes: [
                                "id",
                                "return_qty",
                                "asset_id",
                            ],
                            include: [
                                {
                                    model: AssetReturnImage,
                                    as: "images",
                                    attributes: [
                                        "id",
                                        "image_url",
                                        "stage",
                                        "asset_condition",
                                        "uploaded_at",
                                    ],
                                    separate: true,
                                    order: [["uploaded_at", "DESC"]],
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
    order: [["requested_at", "DESC"]],
});

        if (!requests || requests.length === 0) {
            return res.status(404).json({
                message: "No allocated requests found for active sites",
            });
        }

        const filteredRequests = requests.map(request => {
    const cleanItems = request.items.filter(item => {
        const hasApprovedReturn = item.returnRequests?.some(
            rr => rr.status === "APPROVED"
        );
        return !hasApprovedReturn;
    });

    return {
        ...request.toJSON(),
        items: cleanItems,
    };
});

        // console.log(requests,'requests098')

        res.json(filteredRequests);
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

        // Fetch full details for email
        const fullItem = await AssetRequestItem.findOne({
            where: { id: request_item_id },
            include: [
                {
                    model: Asset,
                    as: "asset",
                    attributes: ["asset_name", "make"],
                },
                {
                    model: AssetRequest,
                    as: "request",
                    include: [
                        {
                            model: User,
                            as: "requestedBy",
                            attributes: ["fullName", "email"],
                        },
                        {
                            model: User,
                            as: "approvedBy",
                            attributes: ["fullName", "email"],
                        },
                    ],
                },
            ],
        });

        const inventoryManagers = await User.findAll({
            where: {
                company_id,
                role: "INVENTORY_MANAGER",
            },
            attributes: ["email"],
        });

        const ccEmails = [
            fullItem.request?.requestedBy?.email,
            ...inventoryManagers.map(u => u.email),
        ].filter(Boolean);

        const adminEmail = fullItem.request?.approvedBy?.email;

        if (adminEmail) {
            await sendGraphMail({
                companyId: company_id,
                to: adminEmail,
                ccRecipients: ccEmails,
                subject: `🔧 Spare Approval Required | ${fullItem.asset.asset_name}`,
                html: `
<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI, Arial; background:#f4f6f9; padding:30px;">
    
<table width="600" align="center" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<tr>
<td style="padding:25px;background:#fff7ed;">
<h2 style="margin:0;">🔧 Spare Approval Requested</h2>
<p style="margin:5px 0 0;font-size:13px;color:#555;">
Spare part request awaiting your approval
</p>
</td>
</tr>

<tr>
<td style="padding:25px;font-size:14px;color:#374151;line-height:1.6;">

<p>Hello <strong>${fullItem.request?.approvedBy?.fullName}</strong>,</p>

<p>
A spare part approval request has been initiated for the below asset.
</p>

<table width="100%" style="background:#f9fafb;border-radius:8px;padding:15px;margin-top:15px;font-size:13px;">

<tr>
<td><strong>Asset:</strong></td>
<td align="right">${fullItem.asset.asset_name}</td>
</tr>

<tr>
<td><strong>Requested By:</strong></td>
<td align="right">${fullItem.request?.requestedBy?.fullName}</td>
</tr>

<tr>
<td><strong>Remarks:</strong></td>
<td align="right">${fullItem.spare_remarks || "No remarks provided"}</td>
</tr>

<tr>
<td><strong>Status:</strong></td>
<td align="right"><strong>REQUESTED</strong></td>
</tr>

</table>

<div style="text-align:center;margin-top:25px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:12px 24px;
background:#ea580c;
color:#fff;
text-decoration:none;
border-radius:6px;
font-weight:600;
">
Review Spare Request
</a>
</div>

</td>
</tr>

<tr>
<td style="background:#f9fafb;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
© ${new Date().getFullYear()} KDM Engineers Group
</td>
</tr>

</table>

</body>
</html>
`
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
            where: { id: request_item_id, company_id },
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

        /* =====================================================
           🔔 FETCH FULL CONTEXT FOR MAIL
        ====================================================== */

        const fullItem = await AssetRequestItem.findOne({
            where: { id: request_item_id },
            include: [
                {
                    model: Asset,
                    as: "asset",
                    attributes: ["asset_name", "make"],
                },
                {
                    model: AssetRequest,
                    as: "request",
                    include: [
                        {
                            model: User,
                            as: "requestedBy",
                            attributes: ["fullName", "email"],
                        },
                        {
                            model: User,
                            as: "approvedBy", // admin_user_id
                            attributes: ["fullName", "email"],
                        },
                    ],
                },
            ],
        });

        if (fullItem) {
            const requestedEmail =
                fullItem.request?.requestedBy?.email;

            const adminEmail =
                fullItem.request?.approvedBy?.email;

            const inventoryManagers = await User.findAll({
                where: {
                    company_id,
                    role: "INVENTORY_MANAGER",
                },
                attributes: ["email"],
            });

            const ccEmails = [
                adminEmail,
                ...inventoryManagers.map(u => u.email),
            ].filter(Boolean);

            if (requestedEmail) {
                const isApproved = decision === "APPROVED";

                await sendGraphMail({
                    companyId: company_id,
                    to: requestedEmail,
                    ccRecipients: ccEmails,
                    subject: `🔩 Spare Request ${decision} | ${fullItem.asset.asset_name}`,
                    html: `
<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI, Arial; background:#f4f6f9; padding:30px;">
    
<table width="600" align="center" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<tr>
<td style="padding:25px;background:${isApproved ? "#ecfdf5" : "#fef2f2"};">
<h2 style="margin:0;">
${isApproved ? "✅ Spare Request Approved" : "❌ Spare Request Rejected"}
</h2>
<p style="margin:5px 0 0;font-size:13px;color:#555;">
Spare request review completed
</p>
</td>
</tr>

<tr>
<td style="padding:25px;font-size:14px;color:#374151;line-height:1.6;">

<p>Hello <strong>${fullItem.request?.requestedBy?.fullName}</strong>,</p>

<p>
Your spare request for the asset 
<strong>${fullItem.asset.asset_name}</strong> 
has been <strong>${decision}</strong>.
</p>

<table width="100%" style="background:#f9fafb;border-radius:8px;padding:15px;margin-top:15px;font-size:13px;">

<tr>
<td><strong>Asset:</strong></td>
<td align="right">${fullItem.asset.asset_name}</td>
</tr>

<tr>
<td><strong>Decision:</strong></td>
<td align="right"><strong>${decision}</strong></td>
</tr>

<tr>
<td><strong>Reviewed At:</strong></td>
<td align="right">
${new Date(item.spare_approved_at).toLocaleString()}
</td>
</tr>

</table>

<div style="text-align:center;margin-top:25px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:12px 24px;
background:${isApproved ? "#16a34a" : "#dc2626"};
color:#fff;
text-decoration:none;
border-radius:6px;
font-weight:600;
">
View Request
</a>
</div>

</td>
</tr>

<tr>
<td style="background:#f9fafb;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
© ${new Date().getFullYear()} KDM Engineers Group
</td>
</tr>

</table>

</body>
</html>
`
                });
            }
        }

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
        // const requestItem = await AssetRequestItem.findOne({
        //     where: {
        //         id: request_item_id,
        //         company_id,
        //     },
        //     attributes: ["requested_qty", "spare_item"],
        //     transaction: t,
        //     lock: t.LOCK.UPDATE,
        // });

        const requestItem = await AssetRequestItem.findOne({
            where: { id: request_item_id },
            include: [
                {
                    model: Asset,
                    as: "asset",
                    attributes: ["asset_name", "make"],
                },
                {
                    model: AssetRequest,
                    as: "request",
                    include: [
                        {
                            model: User,
                            as: "requestedBy",
                            attributes: ["fullName", "email"],
                        },
                        {
                            model: User,
                            as: "approvedBy", // admin_user_id
                            attributes: ["fullName", "email"],
                        },
                    ],
                },
            ],
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



        const inventoryManagers = await User.findAll({
            where: {
                company_id,
                role: "INVENTORY_MANAGER",
            },
            attributes: ["email"],
        });

        const adminEmail =
            requestItem.request?.approvedBy?.email;

        const requestedUserEmail =
            requestItem.request?.requestedBy?.email;

        // 🎯 TO = Inventory Managers + Admin
        const toEmails = [
            adminEmail,
            ...inventoryManagers.map(u => u.email),
        ].filter(Boolean);

        // 📌 CC = Requested person
        const ccEmails = requestedUserEmail
            ? [requestedUserEmail]
            : [];

        // console.log(requestItem, 'requestItem.asset')

        await sendGraphMail({
            companyId:company_id,
            to: toEmails,
            ccRecipients: ccEmails,
            subject: `🔄 Return Initiated | ${requestItem.asset.asset_name}`,
            html: `
<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI, Arial; background:#f4f6f9; padding:30px;">
    
<table width="600" align="center" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<tr>
<td style="padding:25px;background:#eef2ff;">
<h2 style="margin:0;">🔄 Return Request Initiated</h2>
<p style="margin:5px 0 0;font-size:13px;color:#555;">
Asset return process started
</p>
</td>
</tr>

<tr>
<td style="padding:25px;font-size:14px;color:#374151;line-height:1.6;">

<p>
A return request has been initiated for the following asset.
</p>

<table width="100%" style="background:#f9fafb;border-radius:8px;padding:15px;margin-top:15px;font-size:13px;">

<tr>
<td><strong>Asset:</strong></td>
<td align="right">${requestItem.asset.asset_name}</td>
</tr>

<tr>
<td><strong>Quantity:</strong></td>
<td align="right">${return_qty}</td>
</tr>

<tr>
<td><strong>Condition:</strong></td>
<td align="right">${asset_condition}</td>
</tr>

<tr>
<td><strong>Return Type:</strong></td>
<td align="right">${return_type}</td>
</tr>

<tr>
<td><strong>Initiated By:</strong></td>
<td align="right">${requestItem.request?.requestedBy?.fullName}</td>
</tr>

<tr>
<td><strong>Status:</strong></td>
<td align="right">INITIATED</td>
</tr>

</table>

<div style="text-align:center;margin-top:25px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:12px 24px;
background:#2563eb;
color:#fff;
text-decoration:none;
border-radius:6px;
font-weight:600;
">
Review Return Request
</a>
</div>

</td>
</tr>

<tr>
<td style="background:#f9fafb;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
© ${new Date().getFullYear()} KDM Engineers Group
</td>
</tr>

</table>

</body>
</html>
`,
        });

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
// export const reviewReturnRequest = async (req, res) => {
//     const { return_id, decision, inventory_remarks, approvedAdminId } = req.body;
//     const { company_id } = req.user;

//     const t = await sequelize.transaction();
//     try {
//         const request = await AssetReturnRequest.findOne({
//             where: {
//                 return_id,
//                 company_id,
//             },
//             include: [
//                 {
//                     model: AssetReturnItem,
//                     as: "items",
//                     where: { company_id },
//                     include: [{ model: Asset, as: "asset" }],
//                 },
//             ],
//             transaction: t,
//             lock: t.LOCK.UPDATE,
//         });

//         if (!request) {
//             await t.rollback();
//             return res
//                 .status(404)
//                 .json({ message: "Return request not found for this company" });
//         }

//         // 🚫 REJECT FLOW
//         if (decision === "REJECTED") {
//             await request.update(
//                 {
//                     status: "REJECTED",
//                     inventory_remarks,
//                 },
//                 { transaction: t }
//             );

//             await AssetReturnItem.update(
//                 { return_qty: 0 },
//                 {
//                     where: {
//                         return_id,
//                         company_id,
//                     },
//                     transaction: t,
//                 }
//             );

//             await t.commit();
//             return res.json({ message: "Return request rejected" });
//         }

//         // ✅ APPROVAL FLOW
//         if (decision === "APPROVED") {
//             await request.update(
//                 {
//                     status: "APPROVED",
//                     inventory_remarks,
//                 },
//                 { transaction: t }
//             );

//             // 🏢 RETURN TO OFFICE
//             if (request.return_type === "RETURN_TO_OFFICE") {
//                 for (const item of request.items) {
//                     await item.asset.increment("qty", {
//                         by: item.return_qty,
//                         transaction: t,
//                     });
//                 }
//             }

//             // 🔁 TRANSFER TO ANOTHER SITE
//             if (
//                 request.return_type === "TRANSFER_TO_SITE" &&
//                 request.to_site_id
//             ) {
//                 let assetRequest = await AssetRequest.findOne({
//                     where: {
//                         site_id: request.to_site_id,
//                         company_id,
//                     },
//                     transaction: t,
//                     lock: t.LOCK.UPDATE,
//                 });

//                 if (!assetRequest) {
//                     assetRequest = await AssetRequest.create(
//                         {
//                             req_user_id: request.initiated_by,
//                             admin_user_id: approvedAdminId,
//                             admin_approval: "APPROVED",
//                             req_nature: "TRANSFERRED",
//                             site_id: request.to_site_id,
//                             priority_level: "MEDIUM",
//                             request_remarks: `Auto-created from asset transfer (Return ID: ${request.return_id})`,
//                             allocated: 1,
//                             return_identity: request.return_id,
//                             company_id,
//                         },
//                         { transaction: t }
//                     );
//                 }

//                 const requestItems = request.items.map((item) => ({
//                     req_id: assetRequest.req_id,
//                     asset_id: item.asset_id,
//                     requested_qty: item.return_qty,
//                     spare_item: item.spare_check,
//                     company_id,
//                 }));

//                 await AssetRequestItem.bulkCreate(requestItems, {
//                     transaction: t,
//                 });
//             }

//             await t.commit();
//             return res.json({
//                 message: "Return approved and processed successfully",
//             });
//         }

//         await t.rollback();
//         res.status(400).json({ message: "Invalid decision value" });
//     } catch (error) {
//         await t.rollback();
//         console.error("reviewReturnRequest error:", error);
//         res.status(500).json({ message: "Internal server error" });
//     }
// };

export const reviewReturnRequest = async (req, res) => {
    const { return_id, decision, inventory_remarks, approvedAdminId } = req.body;
    const { company_id } = req.user;

    const t = await sequelize.transaction();

    try {

        if (!["APPROVED", "REJECTED"].includes(decision)) {
            return res.status(400).json({
                message: "Invalid decision value"
            });
        }

        const request = await AssetReturnRequest.findOne({
            where: { return_id, company_id },
            include: [
                {
                    model: AssetReturnItem,
                    as: "items",
                    include: [{ model: Asset, as: "asset" }],
                },
                {
                    model: AssetRequestItem,
                    as: "requestItem",
                    include: [
                        {
                            model: AssetRequest,
                            as: "request",
                            include: [
                                {
                                    model: User,
                                    as: "requestedBy",
                                    attributes: ["fullName", "email"],
                                },
                                {
                                    model: User,
                                    as: "approvedBy",
                                    attributes: ["fullName", "email"],
                                },
                            ],
                        },
                    ],
                },
            ],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!request) {
            await t.rollback();
            return res.status(404).json({
                message: "Return request not found for this company",
            });
        }

        /* ===============================
           🚫 REJECT FLOW
        ================================ */

        if (decision === "REJECTED") {

            await request.update(
                { status: "REJECTED", inventory_remarks },
                { transaction: t }
            );

            await AssetReturnItem.update(
                { return_qty: 0 },
                {
                    where: { return_id, company_id },
                    transaction: t
                }
            );
        }

        /* ===============================
           ✅ APPROVED FLOW
        ================================ */

        if (decision === "APPROVED") {

            await request.update(
                { status: "APPROVED", inventory_remarks },
                { transaction: t }
            );

            /* RETURN TO OFFICE */

            if (request.return_type === "RETURN_TO_OFFICE") {

                for (const item of request.items || []) {

                    if (item.asset) {
                        await item.asset.increment("qty", {
                            by: item.return_qty,
                            transaction: t,
                        });
                    }
                }
            }

            /* TRANSFER TO SITE */

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
                            request_remarks: `Auto-created from transfer (Return ID: ${request.return_id})`,
                            allocated: 1,
                            return_identity: request.return_id,
                            company_id,
                        },
                        { transaction: t }
                    );
                }

                const requestItems = (request.items || []).map((item) => ({
                    req_id: assetRequest.req_id,
                    asset_id: item.asset_id,
                    requested_qty: item.return_qty,
                    spare_item: item.spare_check,
                    company_id,
                }));

                if (requestItems.length > 0) {
                    await AssetRequestItem.bulkCreate(requestItems, {
                        transaction: t,
                    });
                }
            }
        }

        await t.commit();

        /* ===============================
           📧 EMAIL AFTER COMMIT
        ================================ */

        const fullContext = await AssetReturnRequest.findOne({
            where: { return_id },
            include: [
                {
                    model: AssetReturnItem,
                    as: "items",
                    include: [{ model: Asset, as: "asset" }],
                },
                {
                    model: AssetRequestItem,
                    as: "requestItem",
                    include: [
                        {
                            model: AssetRequest,
                            as: "request",
                            include: [
                                {
                                    model: User,
                                    as: "requestedBy",
                                    attributes: ["fullName", "email"],
                                },
                                {
                                    model: User,
                                    as: "approvedBy",
                                    attributes: ["fullName", "email"],
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        const requestedUser = fullContext?.requestItem?.request?.requestedBy;
        const adminUser = fullContext?.requestItem?.request?.approvedBy;

        const inventoryManagers = await User.findAll({
            where: {
                company_id,
                role: "INVENTORY_MANAGER",
            },
            attributes: ["email"],
        });

        const ccEmails = [
            adminUser?.email,
            ...inventoryManagers.map((u) => u.email),
        ].filter(Boolean);

        /* ===============================
           BUILD ASSET ROWS HTML
        ================================ */

        const assetRowsHtml = (fullContext?.items || [])
            .map(
                (item) => `
<tr>
<td style="padding:10px;border-bottom:1px solid #e5e7eb;">
${item.asset?.asset_name || "Unknown Asset"}
</td>
<td align="right" style="padding:10px;border-bottom:1px solid #e5e7eb;">
${item.return_qty}
</td>
</tr>
`
            )
            .join("");

        if (requestedUser?.email) {

            const isApproved = decision === "APPROVED";

            await sendGraphMail({
                companyId:company_id,
                to: requestedUser.email,
                ccRecipients: ccEmails,
                subject: `📦 Asset Return ${decision} | Return ID ${return_id}`,
                html: `
<html>
<body style="font-family:Segoe UI;background:#f4f6f9;padding:30px">

<h2 style="color:${isApproved ? "#16a34a" : "#dc2626"}">
${isApproved ? "✅ Asset Return Approved" : "❌ Asset Return Rejected"}
</h2>

<p>Hello <strong>${requestedUser.fullName}</strong>,</p>

<p>
Your asset return request <strong>${return_id}</strong>
has been <strong>${decision}</strong>.
</p>

<table width="100%" style="border-collapse:collapse;border:1px solid #ddd">

<tr style="background:#f3f4f6">
<th align="left" style="padding:10px">Asset</th>
<th align="right" style="padding:10px">Quantity</th>
</tr>

${assetRowsHtml}

</table>

<p style="margin-top:20px">
<strong>Inventory Remarks:</strong><br/>
${inventory_remarks || "No remarks provided"}
</p>

<p style="margin-top:20px;font-size:12px;color:#6b7280">
Inventory Management System<br/>
KDM Engineers Group
</p>

</body>
</html>
`,
            });
        }

        return res.json({
            message: `Return request ${decision.toLowerCase()} successfully`,
        });

    } catch (error) {

        console.error("Return Review Error:", error);

        if (!t.finished) {
            await t.rollback();
        }

        return res.status(500).json({
            message: "Internal server error",
        });
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

    // Fetch full details with relations
    const fullItem = await AssetRequestItem.findOne({
        where: { id: request_item_id },
        include: [
            {
                model: Asset,
                as: "asset",
                attributes: ["asset_name", "units", "make"],
            },
            {
                model: AssetRequest,
                as: "request",
                include: [
                    {
                        model: User,
                        as: "requestedBy",
                        attributes: ["fullName", "email"],
                    },
                    {
                        model: User,
                        as: "approvedBy",
                        attributes: ["fullName", "email"],
                    },
                ],
            },
        ],
    });

    const inventoryManagers = await User.findAll({
        where: {
            company_id,
            role: "INVENTORY_MANAGER",
        },
        attributes: ["email"],
    });

    const ccEmails = [
        ...inventoryManagers.map(u => u.email),
        fullItem.request?.requestedBy?.email, // requested person
    ].filter(Boolean);

    const adminEmail = fullItem.request?.approvedBy?.email;

    if (adminEmail) {
        await sendGraphMail({
            companyId:company_id,
            to: adminEmail,
            ccRecipients: ccEmails,
            subject: `🛠 Servicing Approval Required | ${fullItem.asset.asset_name}`,
            html: `
<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI, Arial; background:#f4f6f9; padding:30px;">
    
<table width="600" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<tr>
<td style="padding:25px;background:#f3f4f6;">
<h2 style="margin:0;">🛠 Servicing Request Notification</h2>
<p style="margin:5px 0 0;font-size:13px;color:#555;">
Asset requires servicing approval
</p>
</td>
</tr>

<tr>
<td style="padding:25px;font-size:14px;color:#374151;line-height:1.6;">
<p>Hello <strong>${fullItem.request?.approvedBy?.fullName}</strong>,</p>

<p>
A servicing request has been submitted for the below asset and is awaiting your approval.
</p>

<table width="100%" style="background:#f9fafb;border-radius:8px;padding:15px;margin-top:15px;font-size:13px;">
<tr>
<td><strong>Asset:</strong></td>
<td align="right">${fullItem.asset.asset_name}</td>
</tr>

<tr>
<td><strong>Requested By:</strong></td>
<td align="right">${fullItem.request?.requestedBy?.fullName}</td>
</tr>

<tr>
<td><strong>Service Person:</strong></td>
<td align="right">${fullItem.service_person_name || "N/A"}</td>
</tr>

<tr>
<td><strong>Mobile:</strong></td>
<td align="right">${fullItem.service_person_mobile || "N/A"}</td>
</tr>

<tr>
<td><strong>Tentative Completion:</strong></td>
<td align="right">
${fullItem.servicing_completed_at
                    ? new Date(fullItem.servicing_completed_at).toLocaleDateString()
                    : "N/A"}
</td>
</tr>

<tr>
<td><strong>Remarks:</strong></td>
<td align="right">${fullItem.servicing_remarks || "None"}</td>
</tr>

</table>

<div style="text-align:center;margin-top:25px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:12px 24px;
background:#2563eb;
color:#fff;
text-decoration:none;
border-radius:6px;
font-weight:600;
">
Review Servicing Request
</a>
</div>

</td>
</tr>

<tr>
<td style="background:#f9fafb;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
© ${new Date().getFullYear()} KDM Engineers Group
</td>
</tr>

</table>

</body>
</html>
`
        });
    }

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

    // Fetch full request context
    const fullItem = await AssetRequestItem.findOne({
        where: { id: request_item_id },
        include: [
            {
                model: Asset,
                as: "asset",
                attributes: ["asset_name", "make"],
            },
            {
                model: AssetRequest,
                as: "request",
                include: [
                    {
                        model: User,
                        as: "requestedBy",
                        attributes: ["fullName", "email"],
                    },
                    {
                        model: User,
                        as: "approvedBy",
                        attributes: ["fullName", "email"],
                    },
                ],
            },
        ],
    });

    const inventoryManagers = await User.findAll({
        where: {
            company_id,
            role: "INVENTORY_MANAGER",
        },
        attributes: ["email"],
    });

    const ccEmails = [
        fullItem.request?.approvedBy?.email, // Admin
        ...inventoryManagers.map(u => u.email),
    ].filter(Boolean);

    const requestedUserEmail = fullItem.request?.requestedBy?.email;

    if (requestedUserEmail) {

        const isApproved = decision === "APPROVED";

        await sendGraphMail({
            companyId:company_id,
            to: requestedUserEmail,
            ccRecipients: ccEmails,
            subject: `🛠 Servicing ${decision} | ${fullItem.asset.asset_name}`,
            html: `
<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI, Arial; background:#f4f6f9; padding:30px;">
    
<table width="600" align="center" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<tr>
<td style="padding:25px;background:${isApproved ? "#ecfdf5" : "#fef2f2"};">
<h2 style="margin:0;">
${isApproved ? "✅ Servicing Approved" : "❌ Servicing Rejected"}
</h2>
<p style="margin:5px 0 0;font-size:13px;color:#555;">
Asset servicing review completed
</p>
</td>
</tr>

<tr>
<td style="padding:25px;font-size:14px;color:#374151;line-height:1.6;">

<p>Hello <strong>${fullItem.request?.requestedBy?.fullName}</strong>,</p>

<p>
Your servicing request for the following asset has been 
<strong>${decision}</strong>.
</p>

<table width="100%" style="background:#f9fafb;border-radius:8px;padding:15px;margin-top:15px;font-size:13px;">

<tr>
<td><strong>Asset:</strong></td>
<td align="right">${fullItem.asset.asset_name}</td>
</tr>

<tr>
<td><strong>Reviewed By:</strong></td>
<td align="right">${fullItem.request?.approvedBy?.fullName}</td>
</tr>

<tr>
<td><strong>Decision:</strong></td>
<td align="right">${decision}</td>
</tr>

<tr>
<td><strong>Reviewer Remarks:</strong></td>
<td align="right">${remarks || "No remarks provided"}</td>
</tr>

<tr>
<td><strong>Reviewed At:</strong></td>
<td align="right">
${new Date(fullItem.servicing_reviewed_at).toLocaleString()}
</td>
</tr>

</table>

<div style="text-align:center;margin-top:25px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:12px 24px;
background:${isApproved ? "#16a34a" : "#dc2626"};
color:#fff;
text-decoration:none;
border-radius:6px;
font-weight:600;
">
View Asset Details
</a>
</div>

</td>
</tr>

<tr>
<td style="background:#f9fafb;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
© ${new Date().getFullYear()} KDM Engineers Group
</td>
</tr>

</table>

</body>
</html>
`
        });
    }

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

    // Fetch full context for mail
    const fullItem = await AssetRequestItem.findOne({
        where: { id: request_item_id },
        include: [
            {
                model: Asset,
                as: "asset",
                attributes: ["asset_name", "make"],
            },
            {
                model: AssetRequest,
                as: "request",
                include: [
                    {
                        model: User,
                        as: "requestedBy",
                        attributes: ["fullName", "email"],
                    },
                    {
                        model: User,
                        as: "approvedBy",
                        attributes: ["fullName", "email"],
                    },
                ],
            },
        ],
    });

    const inventoryManagers = await User.findAll({
        where: {
            company_id,
            role: "INVENTORY_MANAGER",
        },
        attributes: ["email"],
    });

    const ccEmails = [
        fullItem.request?.requestedBy?.email,
        ...inventoryManagers.map(u => u.email),
    ].filter(Boolean);

    const adminEmail = fullItem.request?.approvedBy?.email;

    if (adminEmail) {

        const isCompleted = outcome === "COMPLETED";

        await sendGraphMail({
            companyId:company_id,
            to: adminEmail,
            ccRecipients: ccEmails,
            subject: `🛠 Servicing ${outcome} | ${fullItem.asset.asset_name}`,
            html: `
<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI, Arial; background:#f4f6f9; padding:30px;">
    
<table width="600" align="center" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<tr>
<td style="padding:25px;background:${isCompleted ? "#ecfdf5" : "#fef2f2"};">
<h2 style="margin:0;">
${isCompleted ? "✅ Servicing Completed" : "🗑 Asset Scrapped"}
</h2>
<p style="margin:5px 0 0;font-size:13px;color:#555;">
Servicing cycle has been officially closed
</p>
</td>
</tr>

<tr>
<td style="padding:25px;font-size:14px;color:#374151;line-height:1.6;">

<p>Hello <strong>${fullItem.request?.approvedBy?.fullName}</strong>,</p>

<p>
The servicing process for the following asset has been successfully closed.
</p>

<table width="100%" style="background:#f9fafb;border-radius:8px;padding:15px;margin-top:15px;font-size:13px;">

<tr>
<td><strong>Asset:</strong></td>
<td align="right">${fullItem.asset.asset_name}</td>
</tr>

<tr>
<td><strong>Requested By:</strong></td>
<td align="right">${fullItem.request?.requestedBy?.fullName}</td>
</tr>

<tr>
<td><strong>Outcome:</strong></td>
<td align="right"><strong>${outcome}</strong></td>
</tr>

<tr>
<td><strong>Closed At:</strong></td>
<td align="right">
${new Date().toLocaleString()}
</td>
</tr>

</table>

<div style="text-align:center;margin-top:25px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:12px 24px;
background:${isCompleted ? "#16a34a" : "#dc2626"};
color:#fff;
text-decoration:none;
border-radius:6px;
font-weight:600;
">
View Asset Details
</a>
</div>

</td>
</tr>

<tr>
<td style="background:#f9fafb;padding:15px;text-align:center;font-size:12px;color:#6b7280;">
© ${new Date().getFullYear()} KDM Engineers Group
</td>
</tr>

</table>

</body>
</html>
`
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
