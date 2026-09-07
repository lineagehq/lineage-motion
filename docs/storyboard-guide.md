# Assemble a full animation

Open **Build a full animation**, then **Create an animation**. Give it a name
and choose its first saved shot. An empty animation starts with an 800 × 450
canvas. The first chosen shot otherwise determines the shared canvas size.

Use **Create or import a shot** to open the existing shot creation form. After
creating it, the storyboard selection returns with you. Choose the new shot in
**Saved shot to add**, then **Add shot**. Incompatible canvas sizes and unsupported
sources appear unavailable rather than changing the shot to make it fit.

Each card is a saved occurrence. Its first-frame thumbnail, name, timing and
pinned revision describe committed content. Select the occurrence to rename it
or add an end hold in seconds, with millisecond precision. A hold keeps the
source's native final state; changing its motion duration happens in **Edit
source shot**. **Duplicate occurrence** creates an independently editable copy.
Reorder with **Earlier** and **Later** using pointer or keyboard activation, or
drag one card to its new place. Remove an occurrence and use storyboard Undo or
Redo to restore the saved states.

Editing a source shot does not update its occurrences automatically. When a
newer source revision is available, choose **Update this occurrence** on the
specific card. Other occurrences keep their exact previous references.

**Play all**, **Pause all**, and **Full animation time** control the compiled
full animation. **Shot preview** below remains the individual-shot editor.
**Download full animation** downloads the same saved composition used by Play
all. Unzip it and open `animation.html`; embedded sources remain isolated and
reduced motion follows their original reduced stylesheets at the same cuts.

Unapplied storyboard values remain drafts until their matching Apply button is
used. Switching occurrences, animations or source shots asks you to stay or
explicitly discard that draft. Shot-local drafts use the existing shot-switch
confirmation. While a save is pending, switching is blocked. An unconfirmed
response offers a retry of the exact original command.

Agent updates refresh the saved cards and playback. A local draft remains in
place with a visible conflict notice; discard it before editing the new revision.
An active agent claim blocks human mutations until **Take over animation
editing** explicitly revokes it. This does not change the shot or sequence
content.
