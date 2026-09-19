"""Automated test runner using standard library unittest."""
import sys
import unittest

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # Import test functions and wrap them in unittest.FunctionTestCase
    import tests.test_schemas as ts
    suite.addTest(unittest.FunctionTestCase(ts.test_email_categories))
    suite.addTest(unittest.FunctionTestCase(ts.test_email_classification_valid))
    suite.addTest(unittest.FunctionTestCase(ts.test_email_classification_confidence_bounds))
    suite.addTest(unittest.FunctionTestCase(ts.test_email_input_payload))
    suite.addTest(unittest.FunctionTestCase(ts.test_submission_item_shape))

    import tests.test_attachment_sniffer as tas
    suite.addTest(unittest.FunctionTestCase(tas.test_plain_text_inspection))
    suite.addTest(unittest.FunctionTestCase(tas.test_plain_text_truncation_bound))
    suite.addTest(unittest.FunctionTestCase(tas.test_csv_inspection))
    suite.addTest(unittest.FunctionTestCase(tas.test_docx_inspection))
    suite.addTest(unittest.FunctionTestCase(tas.test_excel_inspection))
    suite.addTest(unittest.FunctionTestCase(tas.test_pdf_inspection_with_text))
    suite.addTest(unittest.FunctionTestCase(tas.test_corrupted_file_safety))

    import tests.test_classifier_flow as tcf
    suite.addTest(unittest.FunctionTestCase(tcf.test_classify_document_comparison))
    suite.addTest(unittest.FunctionTestCase(tcf.test_classify_deceptive_subject_document_comparison))
    suite.addTest(unittest.FunctionTestCase(tcf.test_classify_new_si_request))
    suite.addTest(unittest.FunctionTestCase(tcf.test_classify_invoice_query))
    suite.addTest(unittest.FunctionTestCase(tcf.test_classify_general_schedule))
    suite.addTest(unittest.FunctionTestCase(tcf.test_classify_spam))
    suite.addTest(unittest.FunctionTestCase(tcf.test_missing_attachments_guardrail))
    suite.addTest(unittest.FunctionTestCase(tcf.test_unreadable_attachments_guardrail))

    import tests.test_api as tapi
    suite.addTest(unittest.FunctionTestCase(tapi.test_health_endpoint))
    suite.addTest(unittest.FunctionTestCase(tapi.test_classify_endpoint_document_comparison))
    suite.addTest(unittest.FunctionTestCase(tapi.test_classify_endpoint_invoice))
    suite.addTest(unittest.FunctionTestCase(tapi.test_cors_headers))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
