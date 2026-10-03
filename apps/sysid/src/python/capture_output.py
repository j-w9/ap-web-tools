# Verbatim from upstream SysID/SysID.js init_pyodide: send print() output to the "output" console.
import sys
from js import document

class JsOutput:
    def __init__(self):
        self.output_element = document.getElementById("output")

    def write(self, message):
        self.output_element.value += message

    def flush(self):
        pass

sys.stdout = JsOutput()
sys.stderr = JsOutput()
