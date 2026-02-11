import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const Asset = sequelize.define(
    "Asset",
    {
        asset_id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
            collate: "utf8mb4_bin",
        },

        asset_name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        units: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        make: {
            type: DataTypes.STRING(200),
            allowNull: true,
        },

        asset_type: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: "Reusable",
        },

        asset_condition: {
            type: DataTypes.ENUM("WORKING", "SERVICING"),
            allowNull: false,
            defaultValue: "WORKING",
        },

        asset_status: {
            type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
            allowNull: true,
            defaultValue: null,

        },

        asset_image: {
            type: DataTypes.STRING,
            allowNull: true,
        },

        remarks: {
            type: DataTypes.STRING,
            allowNull: true,
        },

        company_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        }


    },
    {
        tableName: "asset_table",
        timestamps: true,
    }
);

/* ================= ASSOCIATIONS ================= */
Asset.associate = (models) => {
    Asset.hasMany(models.AssetDocument, {
        foreignKey: "asset_id",
        as: "documents",
        onDelete: "CASCADE",
    });

    Asset.hasMany(models.AssetRequestItem, {
        foreignKey: "asset_id",
        as: "pendingItems",
    });

    Asset.belongsTo(models.Company, {
        foreignKey: "company_id",
        as: "company",
    });


};

export default Asset;
