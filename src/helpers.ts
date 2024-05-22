import {Request} from "express";

// Validate file structure
export const requiredColumns = [
    'Customer',
    'Cust No\'',
    'Project Type',
    'Quantity',
    'Price Per Item',
    'Item Price Currency',
    'Total Price',
    'Invoice Currency',
    'Status',
];

export type UploadRequest = Request & {  file?: any; }