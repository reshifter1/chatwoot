import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import AttachmentsPreview from './AttachmentsPreview.vue';

// Build an attachment object shaped like the ones ReplyBox.attachFile pushes
// into `attachedFiles`. The `id` (stamped from the file's monotonic uploadSeq)
// is what makes the keyed v-for in AttachmentsPreview track items across a
// reorder - without it every row keys by `undefined` and the DOM order stops
// following the data after the array is sorted.
const imageAttachment = (id, thumb) => ({
  id,
  resource: { type: 'image/png', name: `img-${id}.png`, size: 100 },
  thumb,
  isVoiceMessage: false,
});

const mountPreview = attachments =>
  mount(AttachmentsPreview, {
    props: { attachments },
    global: { stubs: { Button: true } },
  });

const renderedThumbs = wrapper =>
  wrapper.findAll('img').map(img => img.attributes('src'));

describe('AttachmentsPreview', () => {
  it('renders one image preview per attachment in array order', () => {
    const wrapper = mountPreview([
      imageAttachment(1, 'data:a'),
      imageAttachment(2, 'data:b'),
    ]);

    expect(renderedThumbs(wrapper)).toEqual(['data:a', 'data:b']);
  });

  // Regression guard for the batch-upload ordering fix: the compose-box preview
  // must follow the (uploadSeq-sorted) attachedFiles array. Reordering the prop
  // has to reorder the rendered previews, and each thumbnail must stay with its
  // own item (no cross-contamination from DOM-node reuse under duplicate keys).
  it('reorders previews to match a reordered attachments prop', async () => {
    const a = imageAttachment(1, 'data:a');
    const b = imageAttachment(2, 'data:b');
    const wrapper = mountPreview([a, b]);

    expect(renderedThumbs(wrapper)).toEqual(['data:a', 'data:b']);

    await wrapper.setProps({ attachments: [b, a] });

    expect(renderedThumbs(wrapper)).toEqual(['data:b', 'data:a']);
  });

  // Faithful reproduction of the real compose-box path: attachedFiles is a
  // reactive array mutated IN PLACE (push in upload-completion order, then
  // .sort() by uploadSeq) - the same array reference throughout, unlike the
  // setProps case above. This is the path that actually broke: when the pushed
  // objects lacked a unique `id`, the keyed v-for keyed every row by `undefined`
  // (an unkeyed list), so Vue patched by index and the DOM kept upload-completion
  // order even though the underlying array (and thus the sent payload) was sorted.
  // The unique `id` (stamped from uploadSeq in ReplyBox.attachFile) is what makes
  // the preview follow the sorted order.
  it('follows an in-place sort of the attachments array', async () => {
    const Host = {
      components: { AttachmentsPreview },
      data: () => ({ files: [] }),
      template: '<AttachmentsPreview :attachments="files" />',
    };
    const wrapper = mount(Host, { global: { stubs: { Button: true } } });

    // B (seq 2) uploads/attaches first, A (seq 1) arrives late - out of order.
    wrapper.vm.files.push(imageAttachment(2, 'data:b'));
    wrapper.vm.files.sort((x, y) => x.id - y.id);
    await nextTick();
    wrapper.vm.files.push(imageAttachment(1, 'data:a'));
    wrapper.vm.files.sort((x, y) => x.id - y.id);
    await nextTick();

    expect(renderedThumbs(wrapper)).toEqual(['data:a', 'data:b']);
  });
});
