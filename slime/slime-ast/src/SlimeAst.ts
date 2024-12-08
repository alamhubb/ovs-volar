import {
    type SlimeBooleanLiteral,
    SlimeProgramSourceType,
    SlimeVariableDeclarationKind
} from "./SlimeAstInterface.ts";
import {
    type SlimeCaretEqualsToken,
    type SlimeDirective,
    type SlimeExpression,
    type SlimeIdentifier,
    type SlimeLiteral,
    type SlimeModuleDeclaration,
    type SlimeNumberLiteral,
    type SlimePattern,
    type SlimeProgram,
    type SlimeStatement,
    type SlimeStringLiteral,
    type SlimeVariableDeclaration,
    type SlimeVariableDeclarator
} from "./SlimeAstInterface.ts";

import {SlimeAstType} from "./SlimeAstType.ts";

class SlimeAst {
    createProgram(body: Array<SlimeDirective | SlimeStatement | SlimeModuleDeclaration>, sourceType: SlimeProgramSourceType = SlimeProgramSourceType.script): SlimeProgram {
        return {
            type: SlimeAstType.Program,
            sourceType: sourceType,
            body: body
        }
    }

    createVariableDeclaration(kind: SlimeVariableDeclarationKind, declarations: SlimeVariableDeclarator[]): SlimeVariableDeclaration {
        return {
            type: SlimeAstType.VariableDeclaration,
            declarations: declarations,
            kind: kind
        }
    }

    createVariableDeclarator(id: SlimePattern, init?: SlimeExpression): SlimeVariableDeclarator {
        return {
            type: SlimeAstType.VariableDeclarator,
            id: id,
            init: init,
        }
    }

    createIdentifier(name: string): SlimeIdentifier {
        return {
            type: SlimeAstType.Identifier,
            name: name
        }
    }

    createLiteral(value?: number | string): SlimeLiteral {
        let ast: SlimeLiteral
        if (value === undefined) {
            ast = this.createCaretEqualsToken()
        } else if (typeof value === "string") {
            ast = this.createStringLiteral(value)
        } else if (typeof value === "number") {
            ast = this.createNumericLiteral(value)
        }
        return ast
    }


    createCaretEqualsToken(): SlimeCaretEqualsToken {
        return {
            type: SlimeAstType.CaretEqualsToken
        }
    }


    createStringLiteral(value: string): SlimeStringLiteral {
        return {
            type: SlimeAstType.StringLiteral,
            value: value
        }
    }

    createNumericLiteral(value: number): SlimeNumberLiteral {
        return {
            type: SlimeAstType.NumberLiteral,
            value: value
        }
    }

    createBooleanLiteral(value: boolean): SlimeBooleanLiteral {
        return {
            type: SlimeAstType.BooleanLiteral,
            value: value
        }
    }
}

const SlimeAstUtil = new SlimeAst()
export default SlimeAstUtil