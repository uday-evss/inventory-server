// controllers/dashboardController.js
import db from "../models/index.js";
import { Op, fn, col } from "sequelize";

const { Asset, AssetRequest, AssetRequestItemImage, AssetReturnRequest, SiteData, AssetRequestItem,
    AssetReturnItem,
    AssetReturnImage,
    User

} = db;


export const getDashboardData = async (req, res) => {
    try {
        const { adminId } = req.params;
        const today = new Date();


        /* ================= SITE STATS ================= */

        const siteStatsRaw = await SiteData.findAll({
            include: [{
                model: AssetRequest,
                as: "assetRequests",
                include: [{
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        { model: AssetRequestItemImage, as: "images" },
                        {
                            model: AssetReturnRequest,
                            as: "returnRequests",
                            include: [{
                                model: AssetReturnItem,
                                as: "items",
                                include: [{ model: AssetReturnImage, as: "images" }]
                            }]
                        }
                    ]
                }]
            }]
        });

        const siteStats = siteStatsRaw.map(site => {
            let allocated = 0, used = 0, damaged = 0, returned = 0;

            site.assetRequests?.forEach(req => {
                req.items?.forEach(item => {
                    allocated += item.requested_qty || 0;

                    /* 🔹 USED & DAMAGED FROM USAGE IMAGES */
                    item.images?.forEach(img => {
                        used += img.usage_qty || 0;
                        if (img.asset_condition === "DAMAGED") {
                            damaged += img.usage_qty || 0;
                        }
                    });

                    /* 🔹 RETURNS */
                    item.returnRequests?.forEach(ret => {
                        ret.items?.forEach(retItem => {
                            returned += retItem.return_qty || 0;

                            /* 🔹 DAMAGED FROM RETURN IMAGES */
                            retItem.images?.forEach(img => {
                                if (img.asset_condition === "DAMAGED") {
                                    damaged += retItem.return_qty || 0;
                                }
                            });
                        });
                    });

                    /* 🔹 SCRAPPED FROM SERVICING */
                    if (item.servicing_outcome === "SCRAPPED") {
                        damaged += item.requested_qty || 0;
                    }
                });
            });

            return {
                siteId: site.site_id,
                location: site.location,
                total: allocated,
                allocated,
                used,
                damaged,
                returned,
                bridgeNo: site.bridge_no,
                siteDiv: site.site_division
            };
        });

        /* ================= MANAGER STATS ================= */

        const managers = await User.findAll({ where: { role: "SITE_MANAGER" } });

        const managerStats = await Promise.all(managers.map(async manager => {
            const requests = await AssetRequest.findAll({
                where: { req_user_id: manager.id },
                include: [{
                    model: AssetRequestItem,
                    as: "items",
                    include: [
                        { model: AssetRequestItemImage, as: "images" },
                        {
                            model: AssetReturnRequest,
                            as: "returnRequests",
                            include: [{
                                model: AssetReturnItem,
                                as: "items",
                                include: [{ model: AssetReturnImage, as: "images" }]
                            }]
                        }
                    ]
                }]
            });

            let allocated = 0, used = 0, damaged = 0, returned = 0;

            requests.forEach(req => {
                req.items?.forEach(item => {
                    allocated += item.requested_qty || 0;

                    item.images?.forEach(img => {
                        used += img.usage_qty || 0;
                        if (img.asset_condition === "DAMAGED") {
                            damaged += img.usage_qty || 0;
                        }
                    });

                    item.returnRequests?.forEach(ret => {
                        ret.items?.forEach(retItem => {
                            returned += retItem.return_qty || 0;

                            retItem.images?.forEach(img => {
                                if (img.asset_condition === "DAMAGED") {
                                    damaged += retItem.return_qty || 0;
                                }
                            });
                        });
                    });

                    if (item.servicing_outcome === "SCRAPPED") {
                        damaged += item.requested_qty || 0;
                    }
                });
            });

            return {
                managerId: manager.id,
                name: manager.fullName,
                total: allocated,
                allocated,
                used,
                damaged,
                returned,
            };
        }));


        /* ================= KPIs ================= */

        const totalAssets = await Asset.sum("qty");

        const activeAllocations = await AssetRequest.count({
            where: { allocated: true },
            include: [{
                model: SiteData,
                as: "site",
                required: true,
                where: {
                    [Op.or]: [
                        { site_last_date: { [Op.gte]: today } },
                        { site_last_date: null },
                    ],
                },
            }],
        });

        /* ================= UNERVICEABLE (ENTERPRISE LOGIC) ================= */

        const assetsInServicing = await Asset.count({
            where: { asset_condition: "SERVICING" },
        });

        const scrappedItems = await AssetRequestItem.sum("requested_qty", {
            where: {
                servicing_outcome: "SCRAPPED",
            },
        });

        const unserviceable = (assetsInServicing || 0) + (scrappedItems || 0);


        const pendingApprovals = await AssetRequest.count({
            where: { admin_approval: "PENDING" },
        });

        /* ================= DISTRIBUTION ================= */

        const available = await Asset.sum("qty", {
            where: { asset_condition: "WORKING" },
        });

        const pending = await AssetRequest.count({
            where: { admin_approval: "PENDING" },
        });

        const used = await AssetRequestItemImage.sum("usage_qty");

        /* ================= WEEKLY ================= */

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const requestsProcessed = await AssetRequest.count({
            where: {
                admin_approval: { [Op.ne]: "PENDING" },
                requested_at: { [Op.gte]: weekAgo },
            },
        });

        const assetsReturned = await AssetReturnRequest.count({
            where: { createdAt: { [Op.gte]: weekAgo } },
        });

        const verifications = await AssetRequestItemImage.count({
            where: { uploaded_at: { [Op.gte]: weekAgo } },
        });

        /* ================= 🔥 ACTIVITY FEED ================= */

        const approvals = await AssetRequest.findAll({
            where: { admin_approval: { [Op.ne]: "PENDING" } },
            order: [["requested_at", "DESC"]],
            limit: 1,
        });

        const returns = await AssetReturnRequest.findAll({
            order: [["createdAt", "DESC"]],
            limit: 1,
        });

        const usages = await AssetRequestItemImage.findAll({
            order: [["uploaded_at", "DESC"]],
            limit: 1,
        });

        const activityFeed = [
            ...approvals.map(r => ({
                id: `req-${r.req_id}`,
                type: r.admin_approval === "APPROVED" ? "approved" : "rejected",
                title: `Request ${r.admin_approval}`,
                description: `Request ${r.req_id.slice(0, 8)} processed`,
                user: "Admin",
                createdAt: r.requested_at,
            })),

            ...returns.map(r => ({
                id: `ret-${r.return_id}`,
                type: "returned",
                title: "Assets Returned",
                description: `Return request ${r.return_id.slice(0, 8)}`,
                user: "Site",
                createdAt: r.createdAt,
            })),

            ...usages.map(u => ({
                id: `use-${u.id}`,
                type: "verified",
                title: "Usage Verified",
                description: `${u.usage_qty} qty recorded`,
                user: "Inspector",
                createdAt: u.uploaded_at,
            })),
        ]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10);

        res.json({
            kpis: { totalAssets, activeAllocations, unserviceable, pendingApprovals },
            distribution: { available, allocated: activeAllocations, pending, used, unserviceable },
            weekly: { requestsProcessed, assetsReturned, verifications, flaggedItems: 0 },
            activityFeed,   // 🔥 NEW
            siteStats,
            managerStats,
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Dashboard load failed" });
    }
};
