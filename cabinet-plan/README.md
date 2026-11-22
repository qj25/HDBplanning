# Wardrobe planner

Open **index.html** in a modern browser. Keep the HTML, JavaScript, and CSS files in the same folder. The planner works offline.

The wardrobe measures **1821 mm wide × 2600 mm high × 600 mm deep**. Choose the three- or four-column layout, select a bay to name or assign it, and add parts within that bay. Each layout keeps its own edits.

## Coordinates and editing

The origin is at the bottom-left-front corner as you face the wardrobe. All positions are in millimetres.

| Axis | Positive direction | Cabinet limit |
| --- | --- | ---: |
| X | Right | 1821 |
| Y | Up | 2600 |
| Z | From the front toward the back | 600 |

Select parts from the list or the drawing. Drag dividers horizontally and shelves, rails, and the notch vertically in the front view. For exact positions use the inspector and select **Apply**. An empty X endpoint on a shelf or clothes rail follows that bay edge. Part geometry is schematic.

## Side notch

Select **Side notch**, enable it, choose the side as seen from the front, and select **Apply**. The notch opens through the front and that side. **Surface Y** is the height of its lower face. **Width in from side** and **Depth from front** measure into the cabinet. A 600 mm depth opens through the back. The notch must fit within its outer bay. A shelf can meet the lower face of the notch.

## Pull-out rack

Select a rack and use its **Pull out** slider. The rack pulls towards negative Z, and its sleeve and rear mount remain fixed. Use **Side** to see clearance beyond the front, or **Isometric** to see the enclosure and rail together. Rack travel and usable hanging length are illustrative.

## Save and print

Use **Export JSON** to save both layouts in one file. **Import JSON** opens that file and replaces both current layouts. Browser draft saving is also used when the browser allows storage for a local file. **Print drawings** previews the active layout in front, side, and isometric views. Select **Print** in the preview to open the system print dialog.
