import { requiredColumns, UploadRequest } from "./helpers.js";
import XLSX from 'xlsx';
import { parse, format } from 'date-fns';

export async function uploadHandler(req: UploadRequest, res) {
    const { invoicingMonth } = req.body;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!invoicingMonth || !/^\d{4}-\d{2}$/.test(invoicingMonth)) {
        return res.status(400).json({ error: 'Invalid or missing invoicingMonth. Format should be YYYY-MM.' });
    }

    console.log('request', req.file)
    console.log('invoicingMonth', invoicingMonth)

    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (data.length < 2) {
            return res.status(400).json({ error: 'Invalid file structure.' });
        }
        // Assuming the invoicing date is in the first cell of the first row
        const fileInvoicingMonthStr = data[0][0];
        const fileInvoicingMonth = parse(fileInvoicingMonthStr, 'MMM yyyy', new Date());
        const formattedFileInvoicingMonth = format(fileInvoicingMonth, 'yyyy-MM');
        console.log('formattedFileInvoicingMonth', formattedFileInvoicingMonth)
        if (formattedFileInvoicingMonth !== invoicingMonth) {
            return res.status(400).json({ error: 'Invoicing date in the file does not match the invoicing date provided.' });
        }

        // Find header row -> first row with more than two columns
        const headerRowIdx: number = data.findIndex((row: string[]) => row.length > 2);
        console.log('headerRowIdx', headerRowIdx)
        const headerRow = data[headerRowIdx] as string[];
        console.log('headerRow', headerRow)
        if (!headerRow) {
            return res.status(400).json({ error: 'Invalid file structure. No header row found.' });
        }

        // Check required headers
        const missingHeaders = requiredColumns.filter(header => !headerRow.includes(header));
        console.log('missingHeaders', missingHeaders)
        if (missingHeaders.length > 0) {
            return res.status(400).json({ error: `Missing required columns: ${missingHeaders.join(', ')}` });
        }

        const currencyRatesMap: any = data.slice(1, headerRowIdx).reduce((acc: any, curr) => {
            // if we use strict naming convention then we can extract currency name in the following way
            const currName = curr[0].split(' ')[0];
            const currRateValue = curr[1];
            acc.set(currName, currRateValue)

            return acc;
        }, new Map())
        console.log('currencyRates', currencyRatesMap)

        // let's assume we are not going to have empty rows, only after valid data section. So we can use it as a separator
        const firstEmptyArrayIndex = data.findIndex((arr: Array<[]>) => arr.length === 0);
        // this should be data starting right after header to first empty line;
        const dataBody = data.slice(headerRowIdx+1, firstEmptyArrayIndex);
        //check missing currencies
        const currencyHeaderIndexes: any = headerRow.reduce((acc: number[], next, idx) => {
            if (next.toLowerCase().includes('currency')) {
                acc.push(idx)
            }
            return acc;
        }, [])
        console.log('currencyHeaderIndexes', currencyHeaderIndexes)
        const currList: any = dataBody.reduce((acc: string[], next) => {
            currencyHeaderIndexes.forEach((item) => {
                acc.push(next[item])
            })
            return acc;
        }, []);

        const missingCurr = [...new Set([...currList])].filter((item) => {
            if (!item) return;
            return !currencyRatesMap.has(item);
        });
        console.log('missingCurr', missingCurr)
        // In case we need validation for missing currencies
        // if (missingCurr.length > 0) {
        //     return res.status(400).json({ error: `Invalid file structure. Missing currency rates for ${missingCurr.join(', ')}.` });
        // }

        // Base currency
        // IF ILS rate is not set lets assign default value to it;
        const ILS = 'ILS';
        if(missingCurr.includes(ILS)) {
            currencyRatesMap.set(ILS, 1)
        }

        const invoicesData = dataBody
            .map((row: any[], index) => {
                const globalIndex = index+headerRowIdx+2;
                const updatedRow = headerRow.reduce((acc: any, header: string, index: number) => {
                    acc[header] = row[index];
                    return acc;
                }, {});
                return {
                    globalIndex,
                    ...updatedRow
                }
            })
            .filter((rowData: any) => rowData['Status'] === 'Ready' || rowData['Invoice #'])
            .map((rowData: any, index) => {
                const {  globalIndex } = rowData;
                // console.log('rowData', rowData)
                const validationErrors = requiredColumns.reduce((errors: string[], field: string) => {
                    if (!rowData[field]) {
                        errors.push(`${field} is required in row ${globalIndex}`);
                    }
                    return errors;
                }, []);

                if (!rowData['Invoice #'] && rowData['Status'] !== 'Ready') {
                    validationErrors.push(`Invoice # must be filled if status is not "Ready" - row ${globalIndex}`);
                }

                // Calculate Invoice Total
                let invoiceTotal = 0;
                const totalPrice = parseFloat(rowData['Total Price']);
                const itemPriceCurrency = rowData['Item Price Currency'];
                const invoiceCurrency = rowData['Invoice Currency'];
                const pricePerItem = rowData['Price Per Item'];
                const quantity = rowData['Quantity'];



                if (currencyRatesMap.get(itemPriceCurrency) && currencyRatesMap.get(invoiceCurrency)) {
                    const rate = currencyRatesMap.get(itemPriceCurrency) / currencyRatesMap.get(invoiceCurrency);
                    // Strange currency rates make this calculation not really logical, but I believe it is not a big deal :)
                    invoiceTotal = itemPriceCurrency !== invoiceCurrency ? totalPrice * (currencyRatesMap.get(itemPriceCurrency) / currencyRatesMap.get(invoiceCurrency)) : totalPrice;
                } else {
                    validationErrors.push(`Unsupported currency conversion from ${itemPriceCurrency} to ${invoiceCurrency} on ${globalIndex}. Check the provided currency list`);
                }

                // verify Total Price
                if(totalPrice !== pricePerItem*quantity) {
                    validationErrors.push(`The provided total price ${totalPrice ? totalPrice: ''} does not match the calculated total price ${pricePerItem*quantity ? pricePerItem*quantity : ''} on row ${globalIndex}.`);
                    invoiceTotal = null;
                }

                console.log('invoiceTotal', invoiceTotal);
                rowData['Invoice Total'] = invoiceTotal ? Number(invoiceTotal.toFixed(2)) : invoiceTotal;
                rowData['Validation Errors'] = validationErrors;

                delete rowData.globalIndex;
                return rowData;
            });

        res.json({
            message: 'File uploaded and processed successfully',
            filename: req.file.originalname,
            invoicingMonth: formattedFileInvoicingMonth,
            currencyRates: Object.fromEntries(currencyRatesMap),
            missingCurrency: missingCurr,
            invoicesData
        });
    } catch (error) {
        res.status(500).json({ error: 'Error processing the file' });
    }
}