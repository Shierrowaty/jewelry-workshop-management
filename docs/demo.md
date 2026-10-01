# Demonstration walkthrough

Use a new browser profile or a separate local origin. All values below are fictional demonstration inputs. No automatic seed, production login or data import is included.

## Quotation

Open /nowa-wycena and enter:

| Field | Demo value |
| --- | --- |
| Customer nickname | Klient demonstracyjny |
| Contact channel | Instagram |
| Contact | demo@example.invalid |
| Product category/model | Pierścionki / Klasyczny z jednym kamieniem |
| Variant | Polerowana szyna, pojedynczy kamień |
| Size | 14 |
| Product weight | 5.5 g |
| Gold source | Workshop gold |
| Gold purchase cost | 350 PLN/g net |
| Stone | One diamond, 200 PLN net per piece |
| Other costs | 35 PLN |
| Desired earnings | 4158 PLN |

| Result | Expected amount |
| --- | ---: |
| Net costs | 2160.00 PLN |
| Net revenue | 6885.00 PLN |
| VAT | 1583.55 PLN |
| Gross price | 8468.55 PLN |
| Profit before estimated deduction | 4725.00 PLN |
| Estimated deduction | 567.00 PLN |
| Estimated earnings | 4158.00 PLN |

Save, reload and verify that the order retains its specification and amounts. Change only the status or notes and check that the price does not change. Complete the order, find it in completed orders and restore it.

## Customer gold and quick calculator

At /kalkulator, use mixed customer gold: 2 g of 585 and 1 g of 750, estimated product mass 3 g, target 585 and purchase cost 350 PLN/g. The exact shortfall costs 58.78 PLN net. Change the gross price and then desired earnings to demonstrate both directions.

Save the calculation locally and transfer it into a new quotation. The customer remains blank until entered; the transfer does not create an order until Save quotation is selected.

## Knowledge base

Open Baza wiedzy. Add a fictional stone with supplier Demo supplier, a group such as Szafiry and a per-carat price. Search for the record, edit it and demonstrate archiving through Zarządzaj bazą.

## Offline and conflict demonstration

Offline evaluation requires a configured production build and completed PWA preparation. Automated browser tests use isolated synthetic Supabase responses to demonstrate multiple devices, conflicting edits and reconnection. They do not contact the operational workshop.
