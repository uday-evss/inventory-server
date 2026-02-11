import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const Company = sequelize.define(
    "Company",
    {
        id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },

        company_code: {
            type: DataTypes.STRING(20),
            allowNull: false,
            unique: true,
        },
    },
    {
        tableName: "companies",
        timestamps: true,
    }
);

Company.associate = (models) => {
    Company.hasMany(models.User, {
        foreignKey: "company_id",
        as: "users",
    });

    Company.hasMany(models.SiteData, {
        foreignKey: "company_id",
        as: "sites",
    });

    Company.hasMany(models.Asset, {
        foreignKey: "company_id",
        as: "assets",
    });

    Company.hasMany(models.AssetRequest, {
        foreignKey: "company_id",
        as: "assetRequests",
    });

    Company.hasMany(models.AssetReturnRequest, {
        foreignKey: "company_id",
        as: "assetReturnRequests",
    });
};


export default Company;
