// Clever Youtube Subtitle experiment. MIT; uses unmodified MPL-2.0 MorphoDiTa.
#include "morphodita.h"
#include <emscripten/emscripten.h>
#include <memory>
#include <sstream>
#include <stdexcept>

using namespace ufal::morphodita;
namespace {
class MemoryBuffer : public std::streambuf {
 public:
  MemoryBuffer(const char* bytes, size_t length) {
    char* begin = const_cast<char*>(bytes);
    setg(begin, begin, begin + length);
  }
};
struct Context {
  std::unique_ptr<tagger> model;
  std::unique_ptr<tokenizer> lexer;
  std::vector<string_piece> forms;
  std::vector<tagged_lemma> lemmas;
  std::vector<token_range> ranges;
  std::string result;
};
std::string error;
void quoted(std::string& out, const char* value, size_t length) {
  const char* digits = "0123456789abcdef";
  out += '"';
  for (size_t i = 0; i < length; i++) {
    const unsigned char c = static_cast<unsigned char>(value[i]);
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c < 32) { out += "\\u00"; out += digits[c >> 4]; out += digits[c & 15]; }
    else out += c;
  }
  out += '"';
}
void quoted(std::string& out, const std::string& value) { quoted(out, value.data(), value.size()); }
}
extern "C" {
EMSCRIPTEN_KEEPALIVE const char* morpho_error() { return error.c_str(); }
EMSCRIPTEN_KEEPALIVE Context* morpho_create(const char* bytes, unsigned length) {
  error.clear();
  try {
    if (!bytes || !length || length > 32u * 1024u * 1024u) throw std::runtime_error("Invalid model size.");
    MemoryBuffer buffer(bytes, length);
    std::istream input(&buffer);
    auto context = std::make_unique<Context>();
    context->model.reset(tagger::load(input));
    if (!context->model) throw std::runtime_error("Could not read the model.");
    context->lexer.reset(context->model->new_tokenizer());
    if (!context->lexer) throw std::runtime_error("The model has no tokenizer.");
    return context.release();
  } catch (const std::exception& e) { error = e.what(); return nullptr; }
}
EMSCRIPTEN_KEEPALIVE const char* morpho_analyze(Context* context, const char* text, unsigned length) {
  error.clear();
  try {
    if (!context || !text || length > 200000u) throw std::runtime_error("Invalid text or text too long.");
    context->lexer->set_text(string_piece(text, length), true);
    std::string& out = context->result;
    out.clear(); out += '[';
    bool first = true;
    unsigned sentence = 0;
    while (context->lexer->next_sentence(&context->forms, &context->ranges)) {
      context->model->tag(context->forms, context->lemmas);
      for (size_t i = 0; i < context->forms.size(); i++) {
        if (!first) out += ',';
        first = false;
        out += "{\"form\":";
        quoted(out, context->forms[i].str, context->forms[i].len);
        out += ",\"lemma\":"; quoted(out, context->lemmas[i].lemma);
        out += ",\"pos\":"; quoted(out, context->lemmas[i].tag);
        // MorphoDiTa ranges are Unicode character offsets, not UTF-8 bytes.
        out += ",\"startCodePoint\":" + std::to_string(context->ranges[i].start);
        out += ",\"lengthCodePoints\":" + std::to_string(context->ranges[i].length);
        out += ",\"sentence\":" + std::to_string(sentence) + '}';
      }
      sentence++;
    }
    out += ']';
    return out.c_str();
  } catch (const std::exception& e) { error = e.what(); return nullptr; }
}
EMSCRIPTEN_KEEPALIVE void morpho_destroy(Context* context) { delete context; }
}
