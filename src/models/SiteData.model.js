import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const SiteData = sequelize.define(
    "SiteData",
    {
        site_id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },


        location: {
            type: DataTypes.TEXT,
            allowNull: false,
        },

        bridge_no: {
            type: DataTypes.TEXT,
            allowNull: false,
        },

        site_division: {
            type: DataTypes.TEXT,
            allowNull: true,
        },

        site_last_date: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        tableName: "site_data",
        timestamps: false,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

SiteData.associate = (models) => {
    SiteData.hasMany(models.AssetRequest, {
        foreignKey: "site_id",
        as: "assetRequests",
        onDelete: "CASCADE",
    });
};

export default SiteData;
