import db from "../models/index.js";
const { Company } = db;

// GET COMPANY BY ID (from logged-in user)
export const getCompanyById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const company = await Company.findByPk(id);

        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        res.status(200).json({
            message: "Company fetched",
            data: company,
        });
    } catch (err) {
        next(err);
    }
};
