import db from "../models/index.js";
// import sequelize from "../config/database.js";

const { SiteData, AssetRequest, AssetRequestItem, AssetReturnRequest, AssetReturnItem, AssetRequestItemImage, AssetReturnImage, User, Asset, AssetRequestHistory,AssetRequestItemHistory } = db;

//CREATING A SITE
export const createSite = async (req, res, next) => {
    try {
        const { bridge_no, location, site_division, site_last_date } = req.body;
        const companyId = req.user.company_id;
        const site = await SiteData.create({
            bridge_no,
            location,
            site_division,
            site_last_date,
            company_id: companyId,
        });

        res.status(201).json({ message: "Site created", data: site });
    } catch (err) {
        next(err);
    }
};


//FETCHING ALL SITES
export const getAllSites = async (req, res, next) => {
    try {
        const companyId = req.user.company_id;
        const sites = await SiteData.findAll({
            where: { company_id: companyId },
            order: [["bridge_no", "ASC"]],
        });

        res.status(200).json({
            message: "Sites fetched",
            data: sites,
        });
    } catch (err) {
        next(err);
    }
};


//DELETING A SITE
export const deleteSite = async (req, res, next) => {
    try {
        const { id } = req.params;
        const companyId = req.user.company_id;
        const site = await SiteData.findOne({
            where: {
                site_id: id,
                company_id: companyId,
            },
        });

        if (!site) {
            return res.status(404).json({ message: "Site not found" });
        }

        await site.destroy();

        res.status(200).json({ message: "Site deleted" });
    } catch (err) {
        next(err);
    }
};


// GET SITE BY ID
// export const getSiteById = async (req, res, next) => {
//     try {
//         const site = await SiteData.findByPk(req.params.id, {
//             attributes: [
//                 "site_id",
//                 "bridge_no",
//                 "location",
//                 "site_division",
//                 "site_last_date",
//             ],
//             include: [
//                 {
//                     model: AssetRequest,
//                     as: "assetRequests",
//                     where: {
//                         admin_approval: "APPROVED",
//                         allocated: 1,
//                     },
//                     required: false,
//                     include: [
//                         {
//                             model: User,
//                             as: "requestedBy",
//                             attributes: ["id", "fullName", "username"],
//                         },
//                         {
//                             model: User,
//                             as: "approvedBy",
//                             attributes: ["id", "fullName"],
//                         },
//                         {
//                             model: AssetRequestItem,
//                             as: "items",
//                             required: false,
//                             include: [
//                                 {
//                                     model: Asset,
//                                     as: "asset",
//                                     attributes: [
//                                         "asset_id",
//                                         "asset_name",
//                                         "units",
//                                         "asset_type",
//                                         "asset_condition",
//                                         "asset_status",
//                                         "remarks",

//                                     ],
//                                 },
//                                 {
//                                     model: AssetRequestItemImage,
//                                     as: "images",
//                                     attributes: [
//                                         "id",
//                                         "image_url",
//                                         "usage_qty",
//                                         "asset_condition",
//                                         "uploaded_at",
//                                     ],
//                                     separate: true,
//                                     order: [["uploaded_at", "DESC"]],
//                                 },
//                                 {
//                                     model: AssetReturnRequest,
//                                     as: "returnRequests",
//                                     attributes: [
//                                         "return_id",
//                                         "request_item_id",
//                                         "status",
//                                         "return_type",
//                                         "receiver_remarks",
//                                     ],
//                                     include: [
//                                         {
//                                             model: SiteData,
//                                             as: "fromSite",
//                                             attributes: [
//                                                 "site_id",
//                                                 "bridge_no",
//                                                 "location",
//                                             ],
//                                         },
//                                         {
//                                             model: SiteData,
//                                             as: "toSite",
//                                             attributes: [
//                                                 "site_id",
//                                                 "bridge_no",
//                                                 "location",
//                                             ],
//                                         },
//                                         {
//                                             model: AssetReturnItem,
//                                             as: "items",
//                                             attributes: [
//                                                 "id",
//                                                 "return_qty",
//                                                 "asset_id",
//                                             ],
//                                             include: [
//                                                 {
//                                                     model: AssetReturnImage,
//                                                     as: "images",
//                                                     attributes: [
//                                                         "id",
//                                                         "image_url",
//                                                         "stage",
//                                                         "asset_condition",
//                                                         "uploaded_at",
//                                                     ],
//                                                 },
//                                                 {
//                                                     model: Asset,
//                                                     as: "asset",
//                                                     attributes: [
//                                                         "asset_id",
//                                                         "asset_name",
//                                                         "units",
//                                                     ],
//                                                 },
//                                             ],
//                                         },
//                                     ],
//                                 },
//                             ],
//                         },
//                     ],
//                 },
//             ],
//         });

//         if (!site) {
//             return res.status(404).json({ message: "Site not found" });
//         }

//         res.json({ data: site });
//     } catch (err) {
//         next(err);
//     }
// };

export const getSiteById = async (req, res, next) => {
    try {
      const companyId = req.user.company_id;
      const siteId = req.params.id;

      const site = await SiteData.findOne({
        where: {
          site_id: siteId,
          company_id: companyId,
        },
        attributes: [
          "site_id",
          "bridge_no",
          "location",
          "site_division",
          "site_last_date",
        ],
        include: [
          {
            model: AssetRequest,
            as: "assetRequests",
            required: false,
            where: {
              company_id: companyId,
              admin_approval: "APPROVED",
              allocated: 1,
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
                model: AssetRequestItem,
                as: "items",
                required: false,
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
                    separate: true,
                    order: [["uploaded_at", "DESC"]],
                    where: { company_id: companyId },
                  },
                  {
                    model: AssetReturnRequest,
                    as: "returnRequests",
                    where: { company_id: companyId },
                    required: false,
                    include: [
                      {
                        model: SiteData,
                        as: "fromSite",
                        attributes: ["site_id", "bridge_no", "location"],
                      },
                      {
                        model: SiteData,
                        as: "toSite",
                        attributes: ["site_id", "bridge_no", "location"],
                      },
                      {
                        model: AssetReturnItem,
                        as: "items",
                        include: [
                          {
                            model: AssetReturnImage,
                            as: "images",
                          },
                          {
                            model: Asset,
                            as: "asset",
                            attributes: ["asset_id", "asset_name", "units"],
                          },
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

      if (!site) {
        return res.status(404).json({ message: "Site not found" });
      }

      /* ================= FETCH REQUEST HISTORY ================= */

      const requestHistoryRaw = await AssetRequestHistory.findAll({
        where: {
          site_id: siteId,
          company_id: companyId,
        },
        include: [
          {
            model: User,
            as: "requestedBy",
            attributes: ["id", "fullName"],
          },
          {
            model: User,
            as: "approvedBy",
            attributes: ["id", "fullName"],
          },
        ],
        order: [["action_at", "DESC"]],
      });

      const reqIds = requestHistoryRaw.map((r) => r.req_id);

      /* ================= FETCH ITEM HISTORY ================= */

      let itemHistoryRaw = [];

      if (reqIds.length > 0) {
        itemHistoryRaw = await AssetRequestItemHistory.findAll({
          where: {
            req_id: reqIds,
            company_id: companyId,
          },
          include: [
            {
              model: Asset,
              as: "asset",
              attributes: ["asset_id", "asset_name", "units"],
            },
          ],
          order: [["action_at", "DESC"]],
        });
      }

      /* ================= GROUP HISTORY ================= */

      const historyMap = {};

      requestHistoryRaw.forEach((req) => {
        const r = req.toJSON();

        historyMap[r.req_id] = {
          ...r,
          items: [],
        };
      });

      itemHistoryRaw.forEach((item) => {
        const i = item.toJSON();

        if (historyMap[i.req_id]) {
          historyMap[i.req_id].items.push(i);
        }
      });

      const requestHistory = Object.values(historyMap);

      res.status(200).json({ data: site, requestHistory });
    } catch (err) {
        next(err);
    }
};


// UPDATE SITE
export const updateSite = async (req, res, next) => {
    try {
        const companyId = req.user.company_id;
        const siteId = req.params.id;

        const site = await SiteData.findOne({
            where: {
                site_id: siteId,
                company_id: companyId,
            },
        });

        if (!site) {
            return res.status(404).json({ message: "Site not found" });
        }

        await site.update(req.body);

        res.status(200).json({
            message: "Site updated",
            data: site,
        });
    } catch (err) {
        next(err);
    }
};

