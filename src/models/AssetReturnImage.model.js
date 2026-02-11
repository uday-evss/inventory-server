import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetReturnImage = sequelize.define(
    "AssetReturnImage",
    {
        id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },

        return_item_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        image_url: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        stage: {
            type: DataTypes.ENUM("DISPATCH", "RECEIPT"),
            allowNull: false,
        },

        asset_condition: {
            type: DataTypes.ENUM("REUSABLE", "DAMAGED", "CONSUMED"),
            allowNull: false,
        },

        uploaded_by: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },
        company_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        }
    },
    {
        tableName: "asset_return_images",
        timestamps: true,
        createdAt: "uploaded_at",
        updatedAt: false,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

AssetReturnImage.associate = (models) => {
    AssetReturnImage.belongsTo(models.AssetReturnItem, {
        foreignKey: "return_item_id",
        as: "returnItem",
        onDelete: "CASCADE",
    });

    AssetReturnImage.belongsTo(models.User, {
        foreignKey: "uploaded_by",
        as: "uploadedBy",
    });

    AssetReturnImage.belongsTo(models.Company, {
        foreignKey: "company_id",
        as: "company",
    });

};


export default AssetReturnImage;