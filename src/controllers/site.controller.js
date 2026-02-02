import db from "../models/index.js";
// import sequelize from "../config/database.js";

const { SiteData } = db;

//CREATING A SITE
export const createSite = async (req, res, next) => {
    try {
        const { bridge_no, location, site_division, site_last_date } = req.body;

        const site = await SiteData.create({
            bridge_no,
            location,
            site_division,
            site_last_date,
        });

        res.status(201).json({ message: "Site created", data: site });
    } catch (err) {
        next(err);
    }
};


//FETCHING ALL SITES
export const getAllSites = async (req, res, next) => {
    try {
        const sites = await SiteData.findAll({
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

        const site = await SiteData.findByPk(id);
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
export const getSiteById = async (req, res, next) => {
    try {
        const site = await SiteData.findByPk(req.params.id);
        if (!site) return res.status(404).json({ message: "Site not found" });

        res.json({ data: site });
    } catch (err) {
        next(err);
    }
};

// UPDATE SITE
export const updateSite = async (req, res, next) => {
    try {
        const site = await SiteData.findByPk(req.params.id);
        if (!site) return res.status(404).json({ message: "Site not found" });

        await site.update(req.body);
        res.json({ message: "Site updated", data: site });
    } catch (err) {
        next(err);
    }
};
