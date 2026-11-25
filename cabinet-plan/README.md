# Wardrobe planner

Open **index.html** in a modern browser. Keep the HTML, JavaScript, and CSS files in the same folder. The planner works offline.

The starter wardrobe measures **1821 mm wide × 2600 mm high × 600 mm deep**. Choose the three- or four-column layout, select a bay to name or assign it, and add parts within that bay. Each layout keeps its own edits.

Use **Cabinet dimensions** to set the nominal width, height, and depth. Shape extensions can change the overall dimensions shown on the drawing. Use **Custom columns** to preview a new layout with equal widths or enter exact divider X positions. Each column needs at least 100 mm. Review changes to automatic shelf or rail spans before creating a named layout. The source layout remains available.

## Coordinates and editing

The origin is at the bottom-left-front corner as you face the wardrobe. All positions are in millimetres.

| Axis | Positive direction |
| --- | --- |
| X | Right |
| Y | Up |
| Z | From the front toward the back |

Select parts from the list or drawing. In the front view, drag main dividers horizontally and shelves, rails, and the side notch vertically. Drag a pull-out rack or short divider by its body to move it in X and Y. Select it to reveal handles for one-axis movement. Use the inspector and **Apply** for exact positions. An empty X endpoint on a shelf or clothes rail follows the supported bay edge. Part geometry is schematic.

**Snap while dragging** starts off. Enable it to snap racks to eligible walls or dividers and align shelves and clothes rails with neighbouring parts. **Custom pointer** switches the drawing canvas to a crosshair.

Use **Undo** and **Redo**, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or Ctrl+Y. Each completed drag is a single edit. Press Escape to cancel an in-progress drag.

## Cabinet outline

Open **Outline**, then choose **Cut in**, **Extend out**, or **Round corner**. Select an exposed edge to fill its coordinates. Set a shorter span along the edge, an offset in millimetres, and the front and back Z limits. Use **Preview** to check the result and **Apply** to keep it. Select a feature in the parts list to edit its values or drag its offset and span handles in the front view.

To round a corner, choose an inside or outside corner at the relevant depth and set its radius. A radius of zero gives a square corner. Keep the outline connected and check that edits leave enough room for the parts already in the cabinet.

## Side notch

Select **Side notch**, enable it, choose the side as seen from the front, and select **Apply**. The notch opens through the front and that side. **Surface Y** is the height of its lower face. **Width in from side** and **Depth from front** measure into the cabinet. Setting the notch to the cabinet's full depth opens it through the back. The notch must fit within its outer bay. A shelf can meet the lower face of the notch.

## Pull-out rack

Select a rack and use its **Pull out** slider. The rack pulls towards negative Z, and its sleeve and rear mount remain fixed. Use **Side** to see clearance beyond the front, or **Isometric** to see the enclosure and rail together. Rack travel and usable hanging length are illustrative.

## Save and print

**Export JSON** saves all layouts in one file. **Import JSON** replaces the current layouts and accepts files from the original two-preset version. Browser draft saving is also used when the browser allows storage for a local file.

Turn on **Full measurements** for numbered drawing callouts and a table of exact coordinates and dimensions. Drag an overall dimension line to move its callout or select it for a numeric offset and **Reset position**. **Print drawings** shows the active layout in front, side, and isometric views. The preview has its own **Full measurements** toggle and **Print** opens the system print dialog.
